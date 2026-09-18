# Roadmap

État réel — voir les commits et les issues GitHub liées pour le détail. Chaque ligne cochée est vérifiée par des tests exécutés (pas seulement écrite) ; chaque ligne non cochée est un travail restant, avec la raison précise pour laquelle il n'a pas pu être fait dans cet environnement quand c'est le cas.

## Phase 1 — Fondations cryptographiques

- [x] Parsing BER/DER du SOD (`EF.SOD`, CMS `SignedData`) et extraction du `LDSSecurityObject` — `packages/emrtd-core/src/lds/sod.ts` + `ldsSecurityObjectAsn1.ts`, via pkijs/asn1js. Testé de bout en bout contre une chaîne PKI synthétique réellement signée (RSA-2048/SHA-256).
- [x] Vérification de signature DSC/CSCA — `packages/pki-trust/src/chainValidator.ts` (`dscTrustedByCsca`, `sodSignatureValid`), testée contre un CSCA authentique et un CSCA usurpateur (détection confirmée).
- [ ] Synchronisation avec l'ICAO PKD (LDAP) — `packages/pki-trust/src/pkdClient.ts` reste un stub : l'annuaire LDAP officiel ICAO PKD nécessite un enregistrement/des identifiants d'accès que ce projet n'a pas. Le client est prêt à être branché (`createIcaoPkdClient`) dès qu'un accès est obtenu. `apps/api`'s `PkiTrustService` dégrade proprement (liste d'ancres vide, verdict `manual_review_required`) en attendant.
- [x] Vérification cryptographique Active Authentication (ECDSA) — `packages/emrtd-core/src/lds/activeAuthentication.ts` (`verifyActiveAuthenticationResponse`), testée de bout en bout avec des clés P-256/P-384 synthétiques (usurpation et rejeu détectés). RSA/ISO-9796-2 scheme 1 volontairement non couvert (schéma peu courant, sans référence de vérification disponible ici — voir docstring du module). Branchée dans `AnomalyDetectionService` (`ACTIVE_AUTHENTICATION_FAILED` en critique). L'envoi du défi et la réception de la réponse dépendent de la même session APDU que la Phase 4 ci-dessous.

## Phase 2 — Magasin de confiance étendu

- [x] Structure de données et logique de dégradation de confiance — `packages/pki-trust/src/trustStore.ts` (provenance tracée, jamais `high` par défaut, dégradation automatique à `reviewBeforeDate` échue), testée.
- [ ] Processus opérationnel de revue à deux personnes — à documenter et outiller (process humain, pas seulement du code).
- [ ] Premier jeu de CSCA vérifiés pour des pays hors ICAO PKD — `config/extended-trust-store.json` reste vide ; nécessite une revue cas par cas par pays (voir [pki-trust-model.md](pki-trust-model.md)).

## Phase 3 — Reconnaissance faciale

- [x] Pipeline réel : détection (YuNet) + alignement + embedding (SFace, 128-d) + similarité cosinus + décision à seuil — `services/face-match/app/{face_engine,matcher}.py`, modèles Apache-2.0 (voir `services/face-match/models/README.md`), testé (pytest, 20 tests).
- [x] Détection de vivacité passive (résolution, netteté, unicité du visage) — `services/face-match/app/liveness.py`, honnêtement documentée comme une base heuristique, pas une protection anti-spoofing forte.
- [ ] Liveness active (challenge de mouvement/clignement) — nécessaire pour les clients KYC à politique de risque stricte, pas implémentée.
- [ ] **Audit indépendant des taux de faux positifs/négatifs par sous-groupe démographique et calibration du seuil de décision** — condition explicite avant tout déploiement en production (voir SECURITY.md), non réalisable dans cet environnement de développement.

## Phase 4 — Mobile

- [x] Dérivation de clé de session BAC (Kseed/KEnc/KMac, Doc 9303 Part 11 Appendix D.1) — `packages/emrtd-core/src/mrz/bacKey.ts`, portable (Web Crypto), branchée dans `apps/mobile/src/nfc/emrtdReader.ts`, testée contre l'algorithme de référence.
- [ ] Protocole APDU bas niveau (GET CHALLENGE, MUTUAL AUTHENTICATE, messagerie sécurisée BAC/PACE) et lecture effective des DG/SOD sur la puce — nécessite un vrai document et un vrai lecteur NFC pour être développé et vérifié en toute sécurité ; volontairement non tenté à l'aveugle dans cet environnement (un bug de messagerie chiffrée non détecté par des tests serait une faille de sécurité silencieuse). C'est le seul maillon non branché du pipeline serveur — voir `apps/api/src/modules/verification/chip-data.decoder.ts`, dont le reste du pipeline (chaîne de confiance, anomalies, face-match, verdict, persistance) est déjà réellement câblé et s'exécutera sans modification une fois cette fonction implémentée.
- [ ] UX de capture de la photo vivante avec guide de cadrage.

## Phase 5 — KYC & conformité

- [x] Persistance du résultat de vérification et journal d'audit (RGPD, droit à l'effacement) — Prisma/PostgreSQL, `apps/api/prisma/schema.prisma`, `AuditService.purge()`.
- [x] Traitement asynchrone (BullMQ) — `POST /v1/verifications` répond immédiatement, le pipeline complet tourne en file.
- [x] Authentification par client KYC et politique de risque par client — clé API (`KycApiKeyGuard`, `KycClientService`), provisionnement via `scripts/create-kyc-client.ts`, `acceptedTrustLevels`/`allowedFields` réellement propagés dans `VerificationProcessor`. `GET /v1/verifications/:id` vérifie l'appartenance client (404 si non). OAuth2/mTLS non couverts (voir [kyc-integration.md](kyc-integration.md) "Authentification").
- [ ] Finaliser le contrat API/webhook avec un premier client KYC pilote.
- [ ] Réaliser l'AIPD/DPIA complète (voir [gdpr-compliance.md](gdpr-compliance.md), qui n'est qu'un point de départ).
- [ ] Signature cryptographique des `VerificationResult` (HSM/KMS) — `VerificationResult.signature` est actuellement une chaîne vide, explicitement marquée comme non implémentée.

## Phase 6 — Durcissement production

- [x] Résilience de base : timeout + retry avec backoff + disjoncteur sur l'appel à `services/face-match`, cache TTL des ancres de confiance PKI, limitation de débit, endpoints `/health` (liveness) et `/ready` (readiness DB+Redis) — `apps/api/src/common/resilience/`, `apps/api/src/modules/pki/trust-cache.service.ts`, `apps/api/src/modules/health/`. Tous testés (26 tests unitaires) et vérifiés par un smoke test de démarrage réel (l'API démarre et `/health` répond même sans Postgres/Redis).
- [ ] Faire tourner le worker BullMQ dans un processus séparé de l'API HTTP (scaling horizontal indépendant) — actuellement in-process, suffisant tant que la charge réelle n'est pas connue.
- [ ] Audit de sécurité externe (chaîne de confiance PKI + pipeline biométrique).
- [x] Purge automatisée par politique de rétention — `RetentionSchedulerService` (`@nestjs/schedule`, job quotidien), appelle `AuditService.purgeExpired(DATA_RETENTION_DAYS)`, testée (7 tests).
- [ ] Tests de charge réels.
- [ ] Observabilité applicative (métriques de taux de rejet/anomalie par pays, alerting sur dérive) — la journalisation structurée (Pino) est en place, les métriques/dashboards restent à construire.
