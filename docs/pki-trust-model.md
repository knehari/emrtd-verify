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
