# Audit de sécurité tiers — septembre 2026

Synthèse de l'audit statique réalisé par un tiers (outillage "Codex Security", scan de type
`git_revision` sur le commit `cca6b90`) et du traitement donné à chacune de ses conclusions.
Cet audit correspond à l'item déjà identifié dans [roadmap.md](roadmap.md) ("Audit de sécurité
externe (chaîne de confiance PKI + pipeline biométrique)... non réalisé") — il est désormais fait,
avec 8 constats sur 8 traités (6 corrigés avec tests, 2 documentés comme non actionnables sans
travail plus large déjà scopé ailleurs).

**Limite de l'audit lui-même, à noter honnêtement** : revue statique uniquement (pas d'exploitation
réelle), couverture partielle (281 fichiers, pas d'audit exhaustif ligne à ligne), pas d'accès à une
topologie réseau de production. Les correctifs ci-dessous ont chacun été vérifiés par relecture du
code cité, correction, et ajout de tests réels (pas seulement une confiance dans le rapport).

## Constats et statut

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | `sufficientForClientPolicy` ignorait la validité de la signature SOD, la chaîne DSC↔CSCA et la période de validité du DSC — seul le niveau de l'ancre de confiance comptait | **high** | **Corrigé et testé** |
| 2 | Les CRL ne sont jamais récupérées/fournies en production — `revocationChecked` reste toujours `false` sans dégrader le verdict | medium | **Partiellement traité** (voir ci-dessous) |
| 3 | Un administrateur désactivé/rétrogradé reste privilégié jusqu'à expiration du JWT (12h) | medium | **Corrigé et testé** (admin ET tenant) |
| 4 | `services/face-match` n'exigeait aucune authentification malgré une clé API configurée côté client | medium | **Corrigé et testé** |
| 5 | La liveness passive (résolution/netteté/unicité) était acceptée par la logique de verdict comme une liveness forte | medium | **Corrigé et testé** |
| 6 | Aucune limite de taille/dimension sur les images reçues par `services/face-match` (risque de déni de service) | medium | **Corrigé et testé** |
| 7 | Redis publié sans authentification dans `docker-compose.yml` (dev) | low | **Corrigé** |
| 8 | PostgreSQL publié avec des identifiants par défaut faibles dans `docker-compose.yml` (dev) | low | **Corrigé** |

## Détail des corrections

### 1. Passive Authentication réellement fail-closed (high)

`packages/pki-trust/src/chainValidator.ts` : `sufficientForClientPolicy` exige désormais
conjointement `sodSignatureValid`, `dscTrustedByCsca` et `dscWithinValidityPeriod`, en plus du
niveau de l'ancre de confiance. `apps/api/src/modules/anomaly-detection/anomaly-detection.service.ts`
remonte trois nouvelles anomalies critiques (`SOD_SIGNATURE_INVALID`, `DSC_NOT_TRUSTED_BY_CSCA`,
`DSC_EXPIRED`) pour que le verdict explique toujours *pourquoi*, jamais un simple rejet muet.
Testé (`packages/pki-trust/test/chainValidator.test.ts` : SOD signé par une clé ne correspondant
pas au DSC déclaré, DSC hors validité — deux nouveaux scénarios ; `apps/api/test/anomaly-detection/`
: 4 nouveaux tests).

### 2. Absence de vérification de révocation en production (medium)

Le décodage/la vérification cryptographique d'une CRL (`packages/pki-trust/src/crl.ts`) sont
implémentés et testés, mais **la récupération réseau + la persistance** (fetch périodique par
pays, stockage, cache) ne le sont pas — `PkiTrustService.validate()` n'appelle jamais
`validateTrustChain` avec une CRL. Construire ce pipeline à l'aveugle, sans point d'accès PKD réel
pour le vérifier, comporterait le même risque qu'une implémentation BAC/PACE non vérifiable (voir
[roadmap.md](roadmap.md) Phase 4) — délibérément non tenté ici pour la même raison. **Ce qui a été
fait à la place** : `REVOCATION_NOT_CHECKED` (avertissement) est désormais remonté explicitement
chaque fois que le statut de révocation est inconnu, ce qui dégrade le verdict vers `suspicious`
au lieu de traiter silencieusement l'absence de CRL comme une non-révocation. Le pipeline de
récupération complet reste un item de roadmap à part entière, correctement scopé (voir
[pki-trust-model.md](pki-trust-model.md#révocation)).

### 3. Comptes admin/tenant désactivés restant privilégiés (medium)

`AdminAuthService.verifyToken`/`TenantAuthService.verifyToken` revalident désormais `active` et
`role` en base à chaque requête, au lieu de faire confiance au seul contenu signé du JWT (12h) —
un compte désactivé ou rétrogradé perd immédiatement ses privilèges, plutôt qu'en fin de session.
Corrigé identiquement dans les deux domaines d'authentification (admin ET tenant), le même défaut
existant dans les deux. Testé (4 nouveaux tests : désactivation immédiate, rétrogradation
immédiate, pour chaque domaine).

### 4 et 6. `services/face-match` sans authentification ni limites de ressources (medium)

`services/face-match/app/main.py` : `POST /v1/compare` exige désormais l'en-tête
`Authorization: Bearer <FACE_MATCH_API_KEY>` (déjà envoyé par `apps/api`'s `FaceMatchClient` mais
jamais vérifié côté serveur jusqu'ici), comparé en temps constant (`hmac.compare_digest`), et
échoue fermé (503) si la clé n'est pas configurée côté service plutôt que d'accepter silencieusement.
Ajout de limites explicites sur l'image reçue (taille encodée max, dimensions max, nombre de pixels
max) avant tout décodage/traitement. Testé (`services/face-match/test/test_main.py`, 7 nouveaux
tests : clé absente/incorrecte/correcte, échec fermé sans configuration, dépassement de taille, de
dimension, de nombre de pixels).

### 5. Liveness passive traitée comme liveness forte (medium)

Déjà largement documenté comme limite connue (voir [facial-recognition.md](facial-recognition.md)),
mais rien ne dégradait le verdict en conséquence. `VerificationProcessor` remonte désormais
`LIVENESS_PASSIVE_ONLY` (avertissement) chaque fois que `livenessPassed: true` provient de
l'implémentation passive actuelle — le verdict ne peut plus atteindre `authentic` automatiquement
sur ce seul signal, il est dégradé vers `suspicious` (revue possible), jusqu'à l'implémentation
d'une liveness active (item déjà présent dans [roadmap.md](roadmap.md)).

### 7 et 8. Exposition réseau du stack de développement (low)

`docker-compose.yml` : les ports PostgreSQL (5432) et Redis (6379) sont désormais liés à
`127.0.0.1` uniquement (jamais atteignables depuis le réseau, seulement depuis la machine hôte),
et les identifiants PostgreSQL sont paramétrables via `POSTGRES_USER`/`POSTGRES_PASSWORD`
(`.env.example`, valeurs de développement par défaut identiques à l'existant, à changer pour tout
déploiement au-delà d'un poste local). Validé par `docker compose config` (résolution des
variables et des liaisons de port confirmée).

## Ce que cet audit ne couvre pas

Comme documenté dans [eidas-compliance.md](eidas-compliance.md), le blocage structurel qui limite
la portée réelle de tous ces correctifs reste la lecture NFC de la puce eMRTD elle-même
(`chip-data.decoder.ts`/`emrtdReader.ts`, stubs) : plusieurs constats de cet audit (1, 2, 5) sont
explicitement conditionnés par sa complétion pour être exploitables de bout en bout. Les correctifs
ci-dessus sont néanmoins des corrections réelles et immédiatement effectives — ils garantissent que
le pipeline se comportera correctement dès que la lecture de puce sera branchée, au lieu de
découvrir ces failles à ce moment-là.
