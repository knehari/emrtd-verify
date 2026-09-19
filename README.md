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

Ce qui est **réellement implémenté et testé** (170 tests automatisés, TypeScript + Python) :
- Passive Authentication complète : décodage CMS/SOD, vérification de signature DSC↔CSCA, détection d'altération et d'usurpation (`packages/emrtd-core`, `packages/pki-trust`).
- Active Authentication (ECDSA) : vérification cryptographique challenge-réponse contre la clé publique DG15, détection de clonage (`packages/emrtd-core`).
- Dérivation de clé de session BAC, conforme Doc 9303 Part 11 Appendix D (`packages/emrtd-core`).
- Synchronisation de la CSCA Master List ICAO, modèle de confiance à deux niveaux : Master List ICAO globale (récupération HTTPS/LDAP, vérification via ancres épinglées) et Master Lists nationales par pays (ingestion LDIF, vérifiées contre les CSCA déjà approuvées — jamais d'auto-bootstrap), persistance avec bascule atomique et état de confiance explicite par CSCA. Validé contre un vrai export LDIF ICAO PKD (28 pays) (`packages/pki-trust`, `apps/api` — voir [docs/pki-trust-model.md](docs/pki-trust-model.md)).
- Signature cryptographique des `VerificationResult` (ECDSA P-256, sérialisation JSON canonique) et clé publique distribuée via `GET /v1/verifications/signing-key`, pour que le client KYC détecte une altération en transit/stockage (voir [docs/kyc-integration.md](docs/kyc-integration.md) "Vérification de la signature").
- Reconnaissance faciale (détection + embedding + similarité), liveness passive (`services/face-match`).
- API NestJS de bout en bout : authentification par client KYC (clé API, politique de risque par client), file asynchrone, persistance PostgreSQL/Prisma, cache de confiance PKI, résilience (retry/disjoncteur), rate limiting, purge automatisée de rétention (RGPD), endpoints `/health`/`/ready`, journal d'audit (`apps/api`).
- Processus worker BullMQ séparé de l'API HTTP (`apps/api/src/worker.ts`), scalable indépendamment (`docker compose up --scale worker=N`) — l'API ne fait que produire des jobs, le worker exécute la chaîne de confiance PKI/anomalies/face-match/verdict et expose ses propres métriques Prometheus.
- Observabilité applicative : métriques Prometheus (`GET /metrics`) sur le taux de verdicts, les anomalies et l'état de la chaîne de confiance PKI, labels bornés en cardinalité (jamais de PII ni d'identifiant de vérification) (`apps/api/src/modules/metrics`).

Ce qui reste hors de portée d'un environnement de développement sans matériel/accès réels, documenté précisément dans [docs/roadmap.md](docs/roadmap.md) :
- Le protocole NFC/APDU bas niveau (lecture effective de la puce) — nécessite un vrai document et un vrai lecteur.
- L'accès réel à l'annuaire LDAP officiel ICAO PKD (le pipeline de synchronisation est implémenté et testé, mais jamais exercé contre un vrai serveur ICAO PKD) et le téléchargement automatisé depuis le portail HTTPS (captcha + IP consignée) — nécessite un enregistrement/accès officiel.
- L'audit indépendant du modèle de reconnaissance faciale (biais démographique, calibration) — condition explicite avant production, voir [SECURITY.md](SECURITY.md).

## Stack

TypeScript (NestJS, Expo/React Native) · Python (FastAPI) · pnpm + Turborepo · PostgreSQL · Redis · Docker.

## Licence

[Apache License 2.0](LICENSE).
