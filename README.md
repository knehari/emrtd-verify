# emrtd-verify

Plateforme modulaire de vérification d'authenticité de documents d'identité électroniques conformes **ICAO Doc 9303 (eMRTD)** : passeports biométriques (ePassport), cartes d'identité électroniques (eID) et titres de séjour électroniques (eResidence Card).

L'objectif : donner à un parcours **KYC** un verdict d'authenticité fiable et explicable — champ par champ, chaîne de confiance PKI comprise — pour des documents émis par n'importe quel pays, qu'il participe ou non à l'**ICAO PKD**.

## Ce que fait la plateforme

- **Lecture de la puce** (BAC/PACE via NFC) sur mobile, extraction des groupes de données (DG1–DG16) et de l'objet de sécurité (SOD).
- **Authentification passive** : vérification que chaque DG hashé correspond à l'empreinte signée dans le SOD, et que le certificat Document Signer remonte à un CSCA de confiance.
- **Chaîne de confiance PKI** : ICAO PKD, PKD nationales accessibles, et un magasin de confiance étendu (avec niveau de risque explicite) pour les pays hors PKD.
- **Vérification champ par champ** : cohérence MRZ ↔ VIZ ↔ DG1, chiffres de contrôle, dates de validité, cohérence pays émetteur/nationalité.
- **Détection d'anomalies** : échec de hash, certificat révoqué/expiré, absence d'Active/Chip Authentication (indice de clonage), incohérences structurelles LDS.
- **Reconnaissance faciale** : comparaison de la photo vivante avec la photo DG2 extraite de la puce, avec détection de vivacité (liveness).
- **Restitution KYC** : API/webhook fournissant à une application tierce les attributs d'identité vérifiés et un score de risque, sans exposer de données biométriques brutes au-delà du nécessaire.

## Architecture (monorepo)

```
apps/
  api/            NestJS — orchestration de la vérification, API KYC
  mobile/         Expo/React Native — capture NFC (BAC/PACE)
services/
  face-match/     FastAPI (Python) — reconnaissance faciale + liveness
packages/
  emrtd-core/     Parsing MRZ (TD1/TD2/TD3), structures LDS, SOD
  pki-trust/      CSCA, ICAO PKD, PKD nationales, magasin de confiance étendu
  shared-types/   Types/DTO partagés (résultat de vérification, risque, ...)
docs/             Architecture, modèle de confiance PKI, RGPD/DPIA, menaces, intégration KYC
```

Voir [`docs/architecture.md`](docs/architecture.md) pour le détail des flux de données et [`docs/roadmap.md`](docs/roadmap.md) pour l'état d'avancement.

## Documentation

| Document | Contenu |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Vue d'ensemble, modules, flux de données |
| [docs/pki-trust-model.md](docs/pki-trust-model.md) | CSCA, PKD ICAO/nationales, magasin de confiance étendu, scoring de confiance |
| [docs/verification-checklist.md](docs/verification-checklist.md) | Ce qui est vérifié, champ par champ et étape par étape |
| [docs/facial-recognition.md](docs/facial-recognition.md) | Pipeline de reconnaissance faciale et liveness |
| [docs/gdpr-compliance.md](docs/gdpr-compliance.md) | Base légale, minimisation, rétention, droits des personnes |
| [docs/threat-model.md](docs/threat-model.md) | Menaces considérées et contre-mesures |
| [docs/kyc-integration.md](docs/kyc-integration.md) | Intégration côté application tierce |
| [docs/roadmap.md](docs/roadmap.md) | Feuille de route par phases |

## État du projet

Ce dépôt contient l'**architecture et le squelette de code** (interfaces, types, stubs documentés) — pas encore une implémentation de production. Les modules cryptographiques (Passive Authentication, Active/Chip Authentication, Terminal Authentication) et le matching facial doivent être complétés et audités avant tout usage en production. Voir [SECURITY.md](SECURITY.md).

## Stack

TypeScript (NestJS, Expo/React Native) · Python (FastAPI) · pnpm + Turborepo · PostgreSQL · Redis · Docker.

## Licence

[Apache License 2.0](LICENSE).
