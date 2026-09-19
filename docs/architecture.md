# Architecture

## Vue d'ensemble

```
┌─────────────┐      DG1..DG16, SOD (LDS)      ┌───────────────────────────┐
│ apps/mobile │ ───────────────────────────────▶│ apps/api (NestJS)         │
│ (NFC BAC/   │  + photo vivante (capture live)  │                           │
│  PACE)      │ ───────────────────────────────▶│  VerificationModule       │
└─────────────┘                                  │  ├─ MRZ/LDS parsing       │
                                                  │  │  (packages/emrtd-core) │
                                                  │  ├─ PKI trust chain       │
                                                  │  │  (packages/pki-trust)  │
                                                  │  ├─ AnomalyDetection      │
                                                  │  └─ FaceMatchClient ──────┼──▶ services/face-match (FastAPI)
                                                  │                           │      reconnaissance faciale + liveness
                                                  │  KycModule ───────────────┼──▶ Application tierce (webhook/API)
                                                  │  AuditModule ─────────────┼──▶ Journal d'audit (append-only)
                                                  └───────────────────────────┘
                                                          │
                                                  PostgreSQL (état, audit) · Redis (files/cache)
```

## Modules

### `packages/emrtd-core`

Parsing indépendant de tout framework : lecture des lignes MRZ (TD1/TD2/TD3), calcul et vérification des chiffres de contrôle (ICAO Doc 9303 Part 3 §4.9), types représentant les groupes de données DG1–DG16 (Doc 9303 Part 10), et structures pour le SOD (`EF.SOD`, `CMS SignedData` contenant le `LDSSecurityObject`, Doc 9303 Part 11 §4). Ne dépend d'aucun service externe — testable unitairement, réutilisable côté mobile ou serveur.

### `packages/pki-trust`

Encapsule toute la logique de confiance :

- **`CscaTrustAnchor`** : représentation d'un certificat CSCA de confiance, avec sa source (`icao-pkd`, `national-pkd`, `extended-trust-store`) et son niveau de confiance associé.
- **`MasterListSource`** (`pkdClient.ts`) : récupération de la CSCA Master List ICAO, via HTTPS (`createHttpsMasterListSource`) ou l'annuaire LDAP officiel (`createLdapMasterListSource`) — source configurable, HTTPS recommandé par défaut.
- **`decodeMasterList` / `verifyMasterListTrust`** (`masterList.ts`, `masterListAsn1.ts`) : décodage CMS `SignedData` + structure ICAO `CscaMasterList`, et vérification cryptographique contre des ancres de confiance du Master List Signer épinglées hors bande (jamais le certificat embarqué dans le fichier lui-même).
- **`NationalPkdAdapter`** : interface pour brancher une PKD nationale bilatérale (hors ICAO PKD) quand elle existe.
- **`ExtendedTrustStore`** : magasin de confiance pour les pays qui ne publient ni sur l'ICAO PKD ni sur une PKD nationale accessible — alimenté par un processus de vérification manuelle documenté (voir [pki-trust-model.md](pki-trust-model.md)), jamais utilisé silencieusement en confiance pleine.
- **`ChainValidator`** : construit et valide la chaîne CSCA → Document Signer Certificate → signature du SOD, vérifie la révocation (CRL/Master List de déviation) et la période de validité.

Côté `apps/api`, `CscaSyncService` orchestre la synchronisation périodique (récupération → vérification → persistance avec bascule atomique dans Postgres via Prisma) et `CscaStoreService` sert de chemin de lecture rapide au `ChainValidator`. Voir [pki-trust-model.md](pki-trust-model.md) pour le détail.

### `apps/api` (NestJS)

Orchestrateur. Modules :

- `VerificationModule` : reçoit les données de puce + MRZ + photo vivante, orchestre `emrtd-core` + `pki-trust` + `AnomalyDetection` + `FaceMatchClient`, produit un `VerificationResult` (voir `packages/shared-types`).
- `AnomalyDetectionModule` : règles de détection (hash DG ≠ SOD, signature invalide, CSCA révoqué/expiré, absence d'Active/Chip Authentication, incohérence MRZ ↔ DG1, incohérence structurelle LDS).
- `FaceMatchClient` : client HTTP/gRPC interne vers `services/face-match` — l'API ne fait jamais elle-même de traitement biométrique, elle délègue et ne persiste que le score retourné (voir [gdpr-compliance.md](gdpr-compliance.md)).
- `KycModule` : expose l'API/webhook consommée par l'application tierce (voir [kyc-integration.md](kyc-integration.md)).
- `AuditModule` : journal d'audit append-only (qui a vérifié quoi, avec quel résultat, sans stocker la donnée biométrique brute).

### `services/face-match` (FastAPI, Python)

Service isolé, dédié à la reconnaissance faciale (comparaison photo vivante ↔ DG2) et à la détection de vivacité (liveness). Isolé du reste du système : c'est le seul composant qui manipule des images de visage, avec un cycle de vie de la donnée strictement borné (traitement en mémoire, aucune persistance de l'image par défaut — voir [gdpr-compliance.md](gdpr-compliance.md) et [facial-recognition.md](facial-recognition.md)).

### `apps/mobile` (Expo/React Native)

Capture les données de la puce via NFC (BAC puis, si supporté, PACE — Doc 9303 Part 11 §4/§9), et la photo vivante pour la comparaison faciale. Ne fait aucune validation de confiance côté client : les données brutes sont transmises à `apps/api` qui est la seule source de vérité pour le verdict.

## Flux de données (parcours de vérification)

1. Le mobile établit un canal sécurisé avec la puce (BAC ou PACE) et lit DG1 (MRZ), DG2 (photo), les autres DG pertinents et le SOD.
2. Le mobile capture une photo/vidéo vivante (avec détection de vivacité côté `face-match`).
3. `apps/api` reçoit le payload, `emrtd-core` parse MRZ/DG/SOD.
4. `pki-trust` construit la chaîne de confiance et vérifie la signature du SOD.
5. `AnomalyDetection` recoupe tous les signaux (hash, signature, cohérence champs, absence d'AA/CA, statut de révocation).
6. `FaceMatchClient` envoie DG2 + photo vivante à `services/face-match`, reçoit un score (jamais l'image en retour).
7. `VerificationResult` est assemblé (verdict global, détail par champ, niveau de confiance PKI, score facial, liste d'anomalies) et journalisé (sans donnée biométrique brute) dans `AuditModule`.
8. `KycModule` restitue à l'application tierce les attributs vérifiés + le verdict, selon le contrat défini dans [kyc-integration.md](kyc-integration.md).

## Pourquoi ce découpage

- **Isolation de la biométrie** : un seul service (`face-match`) manipule des images de visage — surface d'attaque et surface RGPD minimisées, facile à héberger séparément ou à faire auditer isolément.
- **Confiance PKI enfichable** : ICAO PKD, PKD nationale ou magasin étendu sont trois implémentations de la même interface (`TrustSource`) — ajouter une nouvelle source de confiance n'impacte pas le reste du système.
- **`emrtd-core` sans dépendance serveur** : réutilisable côté mobile pour une validation préliminaire (UX plus rapide) sans dupliquer la logique métier.
- **API comme unique source de vérité** : le mobile ne décide jamais seul de l'authenticité — évite qu'un client compromis ne falsifie un verdict.
