# Modèle de confiance PKI

## Rappel du mécanisme ICAO (Doc 9303 Part 12)

Chaque document eMRTD contient dans sa puce un `EF.SOD` (Security Object) signé par un **Document Signer Certificate (DSC)**, lui-même signé par le **CSCA (Country Signing CA)** du pays émetteur. La confiance repose sur la capacité à vérifier que ce CSCA est authentique et non révoqué.

```
CSCA (racine, par pays)
  └─ signe → DSC (Document Signer Certificate)
       └─ signe → SOD (hash de chaque DG)
            └─ DG1, DG2, ... (données réellement lues dans la puce)
```

La **Passive Authentication** consiste à : (1) vérifier que le hash de chaque DG lu correspond à celui déclaré dans le SOD, (2) vérifier la signature du SOD avec le DSC, (3) vérifier que le DSC est bien signé par un CSCA de confiance et non révoqué, (4) vérifier les périodes de validité de toute la chaîne.

## Sources de confiance (`TrustSource`)

Le module `packages/pki-trust` définit une interface commune `TrustSource` et trois implémentations, avec un **niveau de confiance explicite attaché à chaque CSCA** — jamais un simple booléen "valide/invalide" :

| Source | Description | Niveau de confiance |
|---|---|---|
| `icao-pkd` | ICAO Public Key Directory — l'annuaire officiel (LDAP), alimenté par les CSCA Master Lists et les CRL publiées par les pays participants. | `high` — mécanisme normatif ICAO |
| `national-pkd` | Échange bilatéral avec une PKD nationale (hors ICAO PKD), lorsqu'un accord existe. | `high` si l'accord et le canal sont documentés et le CSCA authentifié directement par l'autorité émettrice ; `medium` sinon |
| `extended-trust-store` | Magasin de confiance étendu, alimenté manuellement, pour les pays qui ne publient nulle part un CSCA vérifiable en ligne. | `medium` ou `low` selon la provenance (voir ci-dessous) — **jamais `high` par défaut** |

## Synchronisation de la CSCA Master List

Le CSCA n'est utile à la vérification que s'il est disponible localement au moment du contrôle — c'est le rôle de `CscaSyncService` (`apps/api/src/modules/pki/csca-sync.service.ts`) : récupérer périodiquement la CSCA Master List ICAO, la vérifier cryptographiquement, et rendre tous les CSCA qu'elle contient disponibles pour la validation de chaîne, sans jamais dégrader silencieusement la sécurité.

### Pourquoi le stockage est côté backend, pas local à l'application

La demande initiale envisageait un stockage "en backend ou en local dans l'application". Le choix retenu est **exclusivement backend** (PostgreSQL, via Prisma) :

- **Protection des données et intégrité** : les CSCA sont des données publiques, mais leur *ensemble de confiance actif* est une donnée de sécurité — un appareil mobile compromis ou hors ligne ne doit jamais pouvoir servir une liste de CSCA falsifiée ou périmée à la logique de décision. Garder la source de vérité unique côté serveur, où l'accès en écriture est restreint à `CscaSyncService`, élimine cette classe d'attaque.
- **Fiabilité** : `apps/mobile` ne fait que lire les DG/SOD sur la puce (voir Phase 4 de [roadmap.md](roadmap.md)) et transmet au backend pour validation — il n'a donc de toute façon pas besoin d'une copie locale des CSCA pour fonctionner.
- **Rapidité d'exécution malgré tout** : voir "Chemin de lecture" ci-dessous — la lecture est un accès DB indexé derrière un cache mémoire TTL, donc aussi rapide qu'un accès local, sans en avoir les risques.
- **Cohérence** : toutes les instances de l'API partagent le même état de confiance actif au même instant (bascule atomique, voir plus bas), ce qu'un stockage local par appareil ne pourrait pas garantir.

Un export en lecture seule d'un sous-ensemble de CSCA vers un client mobile (pour un mode dégradé hors-ligne, par exemple) est envisageable en évolution future, mais resterait un **cache advisory** non faisant autorité — la décision de confiance resterait toujours revalidée côté backend. Non implémenté à ce stade (pas de besoin produit identifié).

### Bootstrap de confiance de la Master List elle-même

Une Master List CSCA est une structure ASN.1 `CscaMasterList` (Doc 9303 Part 12 §8) encapsulée dans un CMS `SignedData` (OID `2.23.136.1.1.2`), signée par un **Master List Signer** désigné par l'ICAO. Le certificat de ce signataire est *inclus dans le fichier téléchargé lui-même* — il ne peut donc **jamais** servir de preuve de sa propre authenticité (sinon n'importe qui pourrait forger une Master List avec son propre certificat auto-signé inclus).

`verifyMasterListTrust()` (`packages/pki-trust/src/masterList.ts`) résout ce problème en n'acceptant que des signataires trouvés dans un magasin d'ancres **épinglées hors bande** : `config/master-list-signer-trust-anchors.json` (vide par défaut, schéma documenté dans `config/master-list-signer-trust-anchors.README.md`), alimenté manuellement à partir d'une source de confiance indépendante (ex. publication officielle ICAO, canal diplomatique) — jamais depuis le fichier synchronisé. Sans ancre configurée, la synchronisation échoue systématiquement (voir `apps/api/test/pki/csca-sync.service.test.ts`), plutôt que de risquer un auto-bootstrap non sécurisé.

### Pipeline de synchronisation et bascule atomique

`CscaSyncService.sync()`, déclenché quotidiennement (`CscaSyncScheduler`, `@Cron`) ou manuellement (`pnpm --filter @emrtd-verify/api sync-master-list`) :

1. **Récupération** via la source configurée (`PKD_MASTER_LIST_SOURCE=https|ldap`, `packages/pki-trust/src/pkdClient.ts`), avec retry/backoff sur échec transitoire réseau.
2. **Décodage** CMS + structure ICAO (`decodeMasterList`).
3. **Vérification de confiance** contre les ancres épinglées (`verifyMasterListTrust`) — échec = arrêt immédiat, aucun état modifié.
4. **Persistance atomique** : dans une transaction Prisma unique, un nouveau `CscaSyncBatch` (immuable) et ses `CscaCertificateRecord` sont créés, puis le pointeur singleton `CscaTrustState` (id fixe) est basculé vers ce nouveau lot — le tout ou rien garantit qu'il n'existe **jamais d'instant sans confiance valide** : soit l'ancien lot reste actif, soit le nouveau l'est intégralement.
5. **Rétention** : les lots plus anciens au-delà de `CSCA_SYNC_RETAIN_BATCHES` (défaut 2) sont purgés après bascule réussie, en conservant un court historique pour audit/rollback manuel.
6. **Traçabilité** : chaque exécution (succès ou échec, avec message d'erreur) est journalisée dans `MasterListSyncRun`.

Toute erreur à n'importe quelle étape est interceptée et journalisée sans jamais toucher le pointeur `CscaTrustState` actif ni faire remonter d'exception au planificateur — une synchronisation échouée dégrade au pire vers "pas de mise à jour", jamais vers "confiance corrompue".

### Chemin de lecture (validation en cours de vérification)

`CscaStoreService.getAnchorsForCountry(countryCode)` lit uniquement le lot actif (jointure indexée sur `[batchId, countryCode]`, aucun réseau ni calcul cryptographique) et convertit en `CscaTrustAnchor[]` (`source: "icao-pkd"`, `level: "high"`). `PkiTrustService` l'appelle derrière le cache TTL déjà existant (`TrustCacheService`, `TRUST_CACHE_TTL_MS`) — le chemin critique de latence d'une vérification n'est donc jamais impacté par la synchronisation elle-même.

### Ce qui reste non vérifié en conditions réelles

L'accès à l'annuaire LDAP officiel ICAO PKD n'a pas pu être testé de bout en bout : il nécessite un enregistrement ICAO PKD et des identifiants que ce projet n'a pas. Le client LDAP (`createLdapMasterListSource`, via `ldapjs`) est testé unitairement contre un client LDAP factice injecté (`packages/pki-trust/test/pkdClient.test.ts`), mais jamais contre un vrai serveur ICAO PKD. La source HTTPS est l'option recommandée par défaut tant que cet accès n'est pas obtenu.

## Magasin de confiance étendu (pays hors PKD)

C'est le point le plus sensible de l'architecture — c'est aussi ce qui permet de couvrir "un plus grand nombre de documents officiels de pays du monde entier, même ceux qui ne font pas encore partie de la PKD" comme demandé.

Principes :

1. **Aucune confiance implicite.** Un CSCA ajouté au magasin étendu porte toujours un `provenance` explicite (ex. `government-website-tls`, `diplomatic-exchange`, `document-sample-review`, `third-party-attestation`) et un niveau de confiance qui en découle — jamais `high`.
2. **Traçabilité obligatoire.** Chaque entrée référence qui l'a ajoutée, quand, sur quelle base, avec un lien/preuve vers la source. Fichier de config versionné : `config/extended-trust-store.json` (schéma dans `packages/pki-trust/src/trustStore.ts`).
3. **Revue à double contrôle.** Toute addition/modification passe par une revue à deux personnes (voir CONTRIBUTING.md) avant merge.
4. **Le verdict le reflète.** Un document validé via le magasin étendu reçoit un `VerificationResult.trustChain.level` distinct (`extended` / `medium` / `low`) et n'est **jamais présenté comme équivalent** à une validation ICAO PKD dans le résultat retourné au consommateur KYC — voir `packages/shared-types/src/verificationResult.ts`.
5. **Expiration et réévaluation.** Chaque entrée a une date de revue obligatoire (`reviewBeforeDate`) ; passé ce délai, elle est automatiquement dégradée à `low` jusqu'à revue.
6. **Aucune donnée personnelle dans le magasin.** Il ne contient que des certificats publics et des métadonnées de provenance.

## Révocation

- **ICAO PKD / PKD nationale** : vérification contre la CRL publiée et la Master List de déviation.
- **Magasin étendu** : pas de CRL fiable disponible dans la plupart des cas → le niveau de confiance en tient déjà compte (`medium`/`low`), et la fraîcheur de l'entrée (`reviewBeforeDate`) fait office de contrôle compensatoire.

## Ce que l'API expose

`VerificationResult.trustChain` (voir `packages/shared-types`) contient : la source utilisée, le niveau de confiance, la chaîne de certificats jusqu'à la racine, le statut de révocation quand vérifiable, et — crucial pour un usage KYC — un champ explicite indiquant si ce niveau de confiance est **suffisant pour la politique de risque du client** (configurable, voir [kyc-integration.md](kyc-integration.md)).
