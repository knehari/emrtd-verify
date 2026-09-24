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

### Bootstrap de confiance de la Master List ICAO globale (Phase A)

Une Master List CSCA est une structure ASN.1 `CscaMasterList` (Doc 9303 Part 12 §8) encapsulée dans un CMS `SignedData` (OID `2.23.136.1.1.2`), signée par un **Master List Signer**. Le certificat de ce signataire est *inclus dans le fichier téléchargé lui-même* — il ne peut donc **jamais** servir de preuve de sa propre authenticité (sinon n'importe qui pourrait forger une Master List avec son propre certificat auto-signé inclus).

`verifyMasterListTrust()` (`packages/pki-trust/src/masterList.ts`) résout ce problème en n'acceptant que des signataires trouvés dans un magasin d'ancres **épinglées hors bande** : `config/master-list-signer-trust-anchors.json` (vide par défaut, schéma documenté dans `config/master-list-signer-trust-anchors.README.md`), alimenté manuellement à partir d'une source de confiance indépendante (ex. publication officielle ICAO, canal diplomatique) — jamais depuis le fichier synchronisé. Sans ancre configurée, la synchronisation échoue systématiquement (voir `apps/api/test/pki/csca-sync.service.test.ts`), plutôt que de risquer un auto-bootstrap non sécurisé.

### Modèle de confiance à deux niveaux (branche par pays de l'ICAO PKD)

L'annuaire LDAP ICAO PKD publie, en plus d'éventuelles listes consolidées, une **Master List par pays** sous `o=ml,c=XX` — un CMS distinct par pays, signé par une entité propre à ce pays. Vérifié empiriquement sur un vrai export LDIF ICAO PKD (28 pays, fourni par un utilisateur) : dans les 28 cas, le signataire de la Master List nationale est *systématiquement* soit une CSCA de ce même pays (auto-signée agissant comme son propre Master List Signer — Botswana, Ouganda...), soit un certificat distinct émis par elle (Cameroun, Norvège, Lettonie...). **Il n'existe pas d'ancre globale unique pour cette branche** : épingler une ancre par pays (jusqu'à ~190) n'apporterait aucune garantie indépendante, puisqu'elle proviendrait de la même donnée que celle qu'elle est censée authentifier.

La règle de sécurité qui en découle, donc jamais d'auto-bootstrap depuis la Master List nationale elle-même :

```
trusted(countryML) = validCmsSignature(countryML)
                      AND signerChainsTo(CSCA déjà approuvée pour ce pays)
JAMAIS : trusted(countryML) = signerChainsTo(CSCA extraite de countryML lui-même)
```

`verifyCountryMasterListTrust()` (`packages/pki-trust/src/masterList.ts`) implémente cette règle : le signataire doit correspondre — littéralement ou par chaîne courte — à une CSCA déjà présente dans le magasin avec un état de confiance utilisable (voir ci-dessous), jamais à une CSCA extraite du CMS en cours de validation. La primitive de chaîne (`isCertificateTrustedByChain`) est partagée avec `verifyMasterListTrust` et sert aussi au rollover d'une CSCA par certificat de liaison ("Link Certificate", Doc 9303 Part 12) : une nouvelle CSCA signée par une ancienne CSCA déjà approuvée suit exactement la même logique.

### État de confiance par CSCA (`CscaCertificateTrustState`)

Chaque CSCA persistée porte un état explicite (`apps/api/prisma/schema.prisma`), jamais un simple booléen :

| État | Signification | Utilisable comme ancre ? |
|---|---|---|
| `DISCOVERED` | Vue dans une donnée PKD, jamais validée | Non |
| `PKD_OBSERVED` | Reçue du portail/LDAP PKD sans validation de provenance | Non |
| `ICAO_ML_VALIDATED` | Signataire vérifié contre une ancre épinglée hors bande (Phase A) | **Oui** |
| `LINK_VALIDATED` | Reliée à une CSCA déjà approuvée pour ce pays (Phase B, ou rollover) | **Oui** |
| `OUT_OF_BAND_VALIDATED` | Confirmée manuellement (magasin de confiance étendu) | **Oui** |
| `REVOKED_OR_DISTRUSTED` | Révoquée ou retirée de confiance | Non |
| `QUARANTINED` | Incohérence détectée, en attente de revue manuelle | Non |

`CscaStoreService.getAnchorsForCountry()` ne sert jamais que les trois états marqués "Oui".

### Pipeline de synchronisation — Phase A (Master List ICAO globale)

`CscaSyncService.sync()`, déclenché quotidiennement (`CscaSyncScheduler`, `@Cron`) ou manuellement (`pnpm --filter @emrtd-verify/api sync-master-list`) :

1. **Récupération** via la source configurée (`PKD_MASTER_LIST_SOURCE=https|ldap`, `packages/pki-trust/src/pkdClient.ts`), avec retry/backoff sur échec transitoire réseau.
2. **Décodage** CMS + structure ICAO (`decodeMasterList`).
3. **Vérification de confiance** contre les ancres épinglées (`verifyMasterListTrust`) — échec = arrêt immédiat, aucun état modifié.
4. **Persistance atomique** : dans une transaction Prisma unique, un nouveau `CscaSyncBatch` (immuable) et ses `CscaCertificateRecord` (état `ICAO_ML_VALIDATED`) sont créés, puis le pointeur singleton `CscaTrustState` (id fixe) est basculé vers ce nouveau lot — le tout ou rien garantit qu'il n'existe **jamais d'instant sans confiance valide**.
5. **Rétention** : les lots plus anciens au-delà de `CSCA_SYNC_RETAIN_BATCHES` (défaut 2) sont purgés après bascule réussie.
6. **Traçabilité** : chaque exécution est journalisée dans `MasterListSyncRun`.

### Pipeline de synchronisation — Phase B (Master Lists nationales, ingestion LDIF)

`CscaSyncService.syncCountryMasterLists(entries)`, déclenché manuellement (`pnpm --filter @emrtd-verify/api import-pkd-ldif <fichier.ldif>`) : pour chaque entrée `o=ml,c=XX` (extraite par `packages/pki-trust/src/pkdLdif.ts`), vérifie `verifyCountryMasterListTrust` contre les CSCA déjà `ICAO_ML_VALIDATED`/`LINK_VALIDATED`/`OUT_OF_BAND_VALIDATED` de ce pays ; les pays validés voient leurs CSCA (limitées à ce même pays — une Master List nationale peut légitimement en embarquer d'autres, hors périmètre de cette phase) fusionnées en état `LINK_VALIDATED` dans un nouveau lot = copie du lot actif + ajouts, avec la même bascule atomique qu'en Phase A. Un pays sans CSCA déjà approuvée est ignoré (jamais d'auto-bootstrap) plutôt qu'accepté à l'aveugle.

**Pourquoi une ingestion manuelle et non automatisée** : le portail de téléchargement ICAO PKD (https://pkddownload.icao.int/downloads) impose un captcha et consigne l'adresse IP du téléchargement — l'automatiser violerait les conditions d'usage du service. La seule voie ICAO-sanctionnée pour un accès automatisé est un enregistrement LDAP PKD (identifiants fournis à l'inscription, voir Phase A ci-dessus et "Ce qui reste non vérifié" plus bas) ; en son absence, l'import LDIF reste une étape manuelle périodique (l'opérateur télécharge le fichier, puis exécute le script), ce qui reste réaliste pour une mise à jour hebdomadaire/mensuelle plutôt que quotidienne.

Toute erreur à n'importe quelle étape (Phase A ou B) est interceptée et journalisée sans jamais toucher le pointeur `CscaTrustState` actif — une synchronisation échouée dégrade au pire vers "pas de mise à jour", jamais vers "confiance corrompue".

### Chemin de lecture (validation en cours de vérification)

`CscaStoreService.getAnchorsForCountry(countryCode)` lit uniquement le lot actif, filtré aux états de confiance utilisables (jointure indexée sur `[batchId, countryCode]`, aucun réseau ni calcul cryptographique) et convertit en `CscaTrustAnchor[]` (`source: "icao-pkd"`, `level: "high"`). `PkiTrustService` l'appelle derrière le cache TTL déjà existant (`TrustCacheService`, `TRUST_CACHE_TTL_MS`) — le chemin critique de latence d'une vérification n'est donc jamais impacté par la synchronisation elle-même.

### Vérification de signature CMS : ce qu'une vraie Master List a révélé

Décoder et vérifier le vrai export LDIF ICAO PKD mentionné plus haut a exposé trois bugs réels, tous corrigés et testés (voir `packages/emrtd-core/src/crypto/{cms,signatureVerify}.ts`) :

1. **Sélection du certificat signataire.** `decodeMasterList`/`decodeSod` supposaient à tort que le signataire CMS est toujours le premier certificat listé — faux dès que plusieurs certificats sont présents (Botswana : signataire en position 2). `findCmsSignerCertificate` retrouve désormais le bon certificat via `SignerInfo.sid`, y compris quand `sid` est un `SubjectKeyIdentifier` comparé aux octets **réellement déclarés** par l'extension du certificat (jamais un SHA-1(clé publique) recalculé, qui échoue sur la Master List néerlandaise).
2. **Courbes ECDSA non-NIST.** Web Crypto ne supporte que P-256/P-384/P-521. 12 des 28 Master List Signers réels utilisent Brainpool (RFC 5639, BSI TR-03110) ou des paramètres de courbe explicites (Angola). `verifyRawSignature` réplie sur un vérificateur `node:crypto` (OpenSSL, supporte les deux nativement) enregistré par `packages/pki-trust/src/nodeCryptoFallback.ts` — `emrtd-core` reste sans dépendance Node directe (compilé comme dépendance source par `apps/mobile`, sans types Node).
3. **Résolution d'algorithme incomplète.** RSASSA-PSS (RFC 4055, 5 pays réels) et `rsaEncryption` "nu" avec hachage porté par `digestAlgorithm` (France) n'étaient pas gérés — `resolveSignatureScheme` couvre désormais les deux cas.

Après ces correctifs, les 28 entrées du fichier fourni décodent et vérifient avec succès (contre 2/28 avant).

### Ce qui reste non vérifié en conditions réelles

L'accès à l'annuaire LDAP officiel ICAO PKD n'a pas pu être testé de bout en bout : il nécessite un enregistrement ICAO PKD et des identifiants que ce projet n'a pas. Le client LDAP (`createLdapMasterListSource`, via `ldapjs`) est testé unitairement contre un client LDAP factice injecté (`packages/pki-trust/test/pkdClient.test.ts`), mais jamais contre un vrai serveur ICAO PKD. La source HTTPS est l'option recommandée par défaut tant que cet accès n'est pas obtenu. L'ingestion LDIF (Phase B), elle, a été validée contre un vrai export complet.

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

- `validateTrustChain` (`packages/pki-trust/src/chainValidator.ts`) sait vérifier un DSC contre une CRL fournie (`decodeCrl`/`isSerialNumberRevoked`, `packages/pki-trust/src/crl.ts`, testés) — si elle est présente, un serial révoqué produit `revoked: true`, anomalie `CSCA_REVOKED` (critique) et un verdict `rejected`.
- **Limite honnête actuelle** : la **récupération et la persistance** des CRL ICAO PKD ne sont **pas encore câblées en production** — `PkiTrustService.validate()` n'appelle jamais `validateTrustChain` avec une `revocationList`, donc `revocationChecked` reste toujours `false` aujourd'hui. Construire ce pipeline (fetch réseau régulier par pays, décodage, persistance, cache) à l'aveugle, sans un vrai point d'accès PKD pour le valider, comporterait le même risque qu'une implémentation BAC/PACE non vérifiable — voir [roadmap.md](roadmap.md). En attendant, `AnomalyDetectionService` remonte explicitement `REVOCATION_NOT_CHECKED` (avertissement) chaque fois que le statut de révocation n'a pas pu être vérifié, ce qui dégrade le verdict (jamais `authentic` silencieusement) plutôt que de traiter l'absence de CRL comme une non-révocation implicite.
- **Magasin étendu** : pas de CRL fiable disponible dans la plupart des cas → le niveau de confiance en tient déjà compte (`medium`/`low`), et la fraîcheur de l'entrée (`reviewBeforeDate`) fait office de contrôle compensatoire.

## Vérification hors ligne

L'application mobile peut calculer un verdict de vérification entièrement sur l'appareil, sans
connexion réseau au backend — voir `apps/mobile/src/verification/localVerification.ts`,
`apps/mobile/src/pki/cscaBundleSync.ts` et `apps/mobile/src/sync/submissionQueue.ts`.

### Architecture — un seul serveur de confiance, un cache signé côté client

Le principe reste identique à celui de ce document dans son ensemble : la source de vérité unique
reste `apps/api` (Postgres, `CscaSyncService`) — le mobile ne fait jamais confiance à des CSCA
qu'il aurait lui-même récupérés ou reçus d'un tiers. Concrètement :

1. **Endpoint de synchronisation signé** (`GET /v1/pki-trust/csca-bundle`, `apps/api`,
   `PkiTrustController`) : exporte l'ensemble courant des ancres CSCA de confiance ICAO PKD (jamais
   le magasin étendu — voir ci-dessus, ses ancres `medium`/`low` ne doivent jamais être servies à
   un appareil qui ne peut pas les réévaluer) sous forme d'un bundle JSON signé (ECDSA P-256/
   SHA-256, `CscaBundleSignerService`, `packages/pki-trust/src/cscaBundleSigning.ts`).
2. **Clé publique embarquée au build**, jamais récupérée dynamiquement (`appConfig.
   cscaBundleSigningPublicKeyBase64`, `apps/mobile/src/config.ts`) — même principe que
   `config/master-list-signer-trust-anchors.json` : une clé de confiance ne doit jamais transiter
   par un canal qu'elle est censée sécuriser (bootstrap circulaire/MITM).
3. **Cache local vérifié** (`cscaBundleSync.ts`) : le bundle est persisté via `expo-file-system`,
   et RE-VÉRIFIÉ à chaque lecture (`getLocalCscaAnchors`), pas seulement à la réception — un fichier
   local altéré après coup (device compromis) est détecté, pas seulement une transmission altérée.

### Pipeline de vérification locale — mêmes règles, verdict plafonné

`computeLocalVerification` réutilise EXACTEMENT le même code de décision que le chemin serveur
(`@emrtd-verify/verification-policy` — `detectAnomalies`/`computeVerdict`, package partagé et
portable, voir son README) : Passive Authentication (décodage SOD/DG, validation de la chaîne de
confiance contre le bundle CSCA local), Active Authentication si présentée, liveness active si un
challenge a été capturé, et désormais comparaison faciale on-device (voir
[facial-recognition.md](facial-recognition.md) "Reconnaissance faciale hors ligne").

**Le verdict local est structurellement plafonné, jamais `authentic`** : le registre documents
perdus/volés est une donnée serveur uniquement (jamais synchronisée hors ligne, contrairement aux
CSCA — un registre de statut doit rester à jour à la minute près, pas au dernier téléchargement).
`computeLocalVerification` appelle donc systématiquement `detectAnomalies` avec `lostStolenCheck:
{ checked: false, reported: false }`, ce qui déclenche toujours l'avertissement
`LOST_STOLEN_STATUS_NOT_CHECKED` — et donc un verdict local plafonné à `suspicious` au mieux,
jamais `authentic`. Ce n'est pas une limitation accidentelle : c'est la propriété qui rend le champ
`provisional: true` de `LocalVerificationResult` honnête plutôt que cosmétique.

### Réconciliation obligatoire — exigence PVID

Un `LocalVerificationResult` (`provisional: true`) n'est **jamais** transmis au client KYC comme
résultat final : les exigences PVID (revue humaine sur les cas ambigus, piste d'audit centralisée)
ne peuvent structurellement pas être satisfaites par un appareil isolé. `apps/mobile/src/sync/
submissionQueue.ts` met donc en file chaque vérification locale (`enqueueSubmission`) et, dès que
le réseau est disponible (`runSyncCycle`, à appeler périodiquement — retour au premier plan,
reconnexion, minuteur applicatif) : (1) soumet les données brutes à `POST /v1/verifications` (même
endpoint, même pipeline, que le chemin en ligne — aucune divergence de traitement serveur selon
l'origine), avec repli exponentiel plafonné en cas de panne réseau persistante ; (2) interroge
`GET /v1/verifications/:id` jusqu'à obtenir le `VerificationResult` signé, seul résultat faisant
foi. `LocalVerificationResult.provisional` n'est jamais retiré localement — seule la présence d'un
`reconciledResult` sur l'élément de la file (`QueuedSubmission`) marque une vérification comme
définitive.

### Limites honnêtes de ce périmètre v1

- **Magasin étendu** : hors périmètre hors ligne. Un document dont la chaîne de confiance n'en
  dépend que produira `NO_TRUST_ANCHOR` en local, et sera correctement classé lors de la
  réconciliation serveur (qui, lui, l'interroge).
- **Bundle CSCA embarqué** (`apps/mobile/src/pki/defaultCscaBundle.json`, généré par
  `apps/api/scripts/build-mobile-default-csca-bundle.ts`) : Master List ICAO globale (Phase A),
  Master Lists nationales de l'ICAO PKD (Phase B, CSCA du seul pays émetteur) et Master Lists
  publiées par une autorité nationale hors PKD, comme la GermanMasterList du BSI (Phase C). Une
  liste de Phase C n'est retenue que si son signataire est émis par une CSCA déjà approuvée en
  Phase A pour son pays (le « CSCA Master List Signer » du BSI est émis par `csca-germany`, présent
  dans la Master List ICAO), et TOUS ses CSCA sont alors retenus, étrangers compris : l'autorité
  émettrice les a vérifiés avant publication, et c'est ce qui couvre les pays non membres du PKD
  (Algérie, Pologne, Portugal, Grèce, Danemark…). Dédoublonnage par empreinte du certificat, pas
  par pays + numéro de série (des CSCA distincts partagent parfois un numéro, ex. `csca-germany` 01
  de 2011 et de 2013). État au 2026-09-24 (ICAO ML du 2026-09-16, export LDIF PKD n° 531, DE ML du
  2026-05-28) : 789 CSCA, 128 pays, dont 189 apportés par la liste allemande.
- **Révocation (CRL)** : déjà non câblée en ligne (voir section précédente) — donc non plus hors
  ligne, sans régression par rapport au chemin serveur.
- **Reconnaissance faciale on-device** : selfie guidé et comparaison à la photo DG2 sur iOS
  (module natif `apps/mobile/modules/face-kit`, Apple Vision + SFace/ONNX) — voir
  [facial-recognition.md](facial-recognition.md) "Reconnaissance faciale hors ligne" pour le
  détail et les limites (seuils non calibrés, vivacité guidée qui n'est pas une détection
  d'attaque, pas d'équivalent Android).

## Ce que l'API expose

`VerificationResult.trustChain` (voir `packages/shared-types`) contient : la source utilisée, le niveau de confiance, la chaîne de certificats jusqu'à la racine, le statut de révocation quand vérifiable, et — crucial pour un usage KYC — un champ explicite indiquant si ce niveau de confiance est **suffisant pour la politique de risque du client** (configurable, voir [kyc-integration.md](kyc-integration.md)).
