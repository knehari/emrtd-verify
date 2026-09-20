# Interface d'administration interne (SaaS)

## Principe

Une interface web réservée au personnel opérationnel de la plateforme (pas aux tenants tiers, voir [tenant-portal.md](tenant-portal.md)) : gestion des tenants (clients KYC), gestion des comptes administrateurs, revue globale des vérifications, et un lien vers le dashboard Grafana (voir [roadmap.md](roadmap.md) Phase 4). Le frontend (`apps/admin-web`, Next.js 14 App Router + Tailwind + Radix UI + React Query) est implémenté : pages Connexion, Tableau de bord (KPIs + répartition des verdicts), Tenants (CRUD), Vérifications (revue globale filtrée/paginée), Administrateurs (CRUD, réservé SUPER_ADMIN). Vérifié par un vrai build de production (`next build`) et un parcours utilisateur réel en navigateur (connexion, création de tenant avec révélation de clé API une seule fois, RBAC, aucune erreur console) — voir "Vérification" ci-dessous.

## Tableau de bord (KPIs)

`GET /admin/dashboard/stats` (`AdminDashboardController`/`AdminDashboardService`) agrège : tenants totaux/actifs, nombre d'administrateurs, vérifications des dernières 24h, répartition par verdict — alimente les cartes KPI et le graphique (recharts) de `apps/admin-web`.

## Authentification

Session par cookie httpOnly (`admin_session`), signé (JWT, `ADMIN_JWT_SECRET`), 12h de validité — voir `AdminAuthService`/`AdminAuthController`.

- `POST /admin/auth/login` — `{ email, password }` → pose le cookie de session. Limité à 5 tentatives/minute/IP (voir `ThrottlerModule`/`@Throttle`).
- `POST /admin/auth/logout` — efface le cookie.
- `GET /admin/auth/me` — session courante (authentifié).

**Provisionnement** : hors API, jamais par auto-inscription — `pnpm --filter @emrtd-verify/api create-admin-user -- --email=... --role=SUPER_ADMIN|SUPPORT` (voir `scripts/create-admin-user.ts`). Le mot de passe temporaire généré n'est affiché qu'une seule fois.

**Mots de passe** : hachés par scrypt (`node:crypto`, voir `common/security/password-hasher.ts`) — pas de dépendance native (argon2/bcrypt), cohérent avec le hachage de clé API existant (`KycClientService.hashApiKey`).

## Sécurité du compte (2FA et mot de passe en libre-service)

Voir `common/security/totp.ts` (TOTP RFC 6238 via `otplib`, pas une réimplémentation maison — voir la note de justification dans ce fichier) et `AdminAuthService`/`AdminAuthController`.

- `POST /admin/auth/change-password` — `{ currentPassword, newPassword }` (authentifié) : exige le mot de passe actuel, jamais la seule session.
- `POST /admin/auth/2fa/setup` — génère et persiste un nouveau secret TOTP (sans l'activer), renvoie `{ secret, otpauthUrl, qrCodeDataUrl }` (QR PNG en data URL, généré côté serveur via `qrcode`).
- `POST /admin/auth/2fa/enable` — `{ code }` : confirme le secret de `2fa/setup` avec un premier code valide, active `totpEnabled`.
- `POST /admin/auth/2fa/disable` — `{ password }` : exige le mot de passe (action sensible), efface le secret.
- `POST /admin/auth/2fa/verify` — seconde étape du login (voir ci-dessous), 5 tentatives/minute/IP comme `login`.

**Flux de connexion à deux étapes** : si `totpEnabled`, `POST /admin/auth/login` ne pose plus de cookie de session et renvoie `{ requiresTwoFactor: true, challengeToken }` (JWT distinct, 5 minutes, jamais accepté par les routes protégées grâce à un champ `typ` différent). Le frontend enchaîne avec `POST /admin/auth/2fa/verify { challengeToken, code }`, qui pose alors le cookie. Un compte sans 2FA garde le comportement à une étape inchangé.

## Rôles

Deux rôles (`AdminRole`) : `SUPPORT` (lecture seule sur tout, revue des vérifications) et `SUPER_ADMIN` (toute écriture : CRUD tenants, CRUD comptes administrateurs). Appliqué par `AdminRolesGuard`/`@RequireAdminRole("SUPER_ADMIN")`.

## CRUD clients KYC (tenants)

Réservé aux administrateurs internes (jamais en self-service côté tenant — décision retenue explicitement, voir [roadmap.md](roadmap.md)) — voir `AdminKycClientsController`/`AdminKycClientsService`.

- `GET /admin/kyc-clients` — liste (SUPPORT ou SUPER_ADMIN).
- `GET /admin/kyc-clients/:clientId` — détail.
- `POST /admin/kyc-clients` (SUPER_ADMIN) — crée un tenant, renvoie la clé API en clair **une seule fois**.
- `PATCH /admin/kyc-clients/:clientId` (SUPER_ADMIN) — modifie `acceptedTrustLevels`/`allowedFields`/`active` (suspension).
- `POST /admin/kyc-clients/:clientId/rotate-key` (SUPER_ADMIN) — invalide l'ancienne clé API, en renvoie une nouvelle en clair.

Aucune réponse ne contient jamais `apiKeyHash`.

## CRUD comptes administrateurs

Voir `AdminUsersController`/`AdminUsersService` — `GET /admin/admin-users`, `POST /admin/admin-users` (SUPER_ADMIN, renvoie un mot de passe temporaire une seule fois), `PATCH /admin/admin-users/:id` (SUPER_ADMIN, rôle/activation).

## Revue globale des vérifications

Voir `AdminVerificationsController`/`AdminVerificationsService` — vue opérateur tous tenants confondus, distincte de la revue tenant (scopée à un seul tenant, voir [tenant-portal.md](tenant-portal.md)). Un administrateur voit le `VerificationResult` complet (pas de filtrage `allowedFields` : rôle opérationnel de confiance).

- `GET /admin/verifications?page=&pageSize=&verdict=&clientId=&issuingCountry=` — liste paginée/filtrée.
- `GET /admin/verifications/:verificationId` — détail complet.

## Dashboard Grafana

Prometheus et Grafana sont provisionnés dans `docker-compose.yml` (services `prometheus`, `grafana`), prêts à l'emploi sans configuration manuelle — voir [roadmap.md](roadmap.md) Phase 7. `prometheus` scrape les deux endpoints `/metrics` réels (`config/prometheus/prometheus.yml`) : l'API HTTP (`api:3000`) et le worker BullMQ, processus séparé avec son propre registre `prom-client` (`worker:3001`, voir `apps/api/src/worker.ts`). `grafana` charge automatiquement au démarrage une source de données Prometheus (`config/grafana/provisioning/datasources/`) et un dashboard versionné (`config/grafana/dashboards/emrtd-verify.json`) : vérifications (24h), taux d'authenticité, anomalies détectées, durée de traitement (p50/p95/p99), répartition par verdict, anomalies par sévérité, chaîne de confiance PKI par source — tous branchés sur les métriques réelles de `MetricsService` (voir `apps/api/src/modules/metrics/`). Accessible sur `http://localhost:3002` (mot de passe admin : `GRAFANA_ADMIN_PASSWORD`, voir `.env.example`). L'interface d'administration expose un simple lien vers cette URL via `NEXT_PUBLIC_GRAFANA_URL` (pas d'authentification unifiée SSO en v1 — limite assumée).

**Vérification** : `docker compose config` valide la définition des deux services ; `config/prometheus/prometheus.yml` validé avec `promtool check config` (paquet `prometheus` officiel) ; un vrai binaire Prometheus lancé localement contre l'API et le worker réels (tous deux démarrés en HTTP réel) confirme les deux cibles `up` après scraping, et chacune des requêtes PromQL du dashboard (`histogram_quantile`, `sum by (verdict|severity|source,level) (rate(...))`, etc.) s'exécute sans erreur contre les métriques réellement exposées. **Limite assumée de cette session** : Grafana lui-même (l'image `grafana/grafana`) n'a pas pu être démarré ni ouvert dans un navigateur — la politique réseau de cet environnement bloque l'accès à Docker Hub et à `dl.grafana.com` (même contrainte que l'accès réel à l'annuaire ICAO PKD, voir [roadmap.md](roadmap.md)). Le chargement effectif du dashboard dans l'interface Grafana (rendu des panneaux, résolution du datasource par `uid`) reste donc à confirmer visuellement sur une machine avec accès réseau complet, via `docker compose up prometheus grafana`.

## Vérification

- **Typecheck + build de production** réels (`pnpm --filter @emrtd-verify/admin-web exec tsc --noEmit`, `next build`) — 8 routes compilées sans erreur (dont `/settings`, nouvelle).
- **Parcours réel en navigateur** (Chromium headless) contre l'API réelle et un Postgres local : connexion (cookie de session posé), tableau de bord affichant les vrais compteurs, création d'un tenant avec révélation de clé API une seule fois, rafraîchissement automatique de la liste (React Query), page Vérifications (filtres, état vide correct), page Administrateurs (RBAC — un SUPPORT ne peut pas écrire côté API ; côté UI, seul un SUPER_ADMIN voit la page). Aucune erreur ni avertissement dans la console du navigateur sur l'ensemble du parcours.
- **2FA et mot de passe** : parcours complet en navigateur réel — changement de mot de passe, configuration 2FA (QR code réellement scanné via un code TOTP calculé côté script de test à partir du secret affiché), déconnexion, reconnexion avec le flux à deux étapes (code de vérification requis, code TOTP réellement calculé et accepté), puis désactivation du 2FA (mot de passe requis, rejet d'un mot de passe incorrect confirmé). Trois bugs réels trouvés et corrigés pendant cette vérification :
  1. La boîte de dialogue de configuration 2FA restait bloquée sur "Chargement…" : le lancement de `2fa/setup` était déclenché dans `Dialog.onOpenChange`, qui ne se déclenche pas pour un changement programmatique de la prop `open` piloté par le parent (même classe de bug que celui déjà documenté dans [tenant-portal.md](tenant-portal.md)) — corrigé avec un `useEffect` sur `open`.
  2. `POST /admin/auth/2fa/setup` (et `logout`) renvoyait 500 : le client HTTP posait toujours `Content-Type: application/json` même sans corps, que Fastify rejette avec "Body cannot be empty…" — corrigé en ne posant ce header que si un corps est réellement envoyé (`apps/admin-web/src/lib/api-client.ts`).
  3. Le champ "Code de vérification" de l'étape 2FA du login affichait l'adresse email saisie à l'étape précédente : React réutilisait le nœud DOM de l'`<input>` entre les deux `<form>` conditionnellement rendus (même position dans l'arbre), et la valeur autofill/laissée par le navigateur y persistait — corrigé en donnant une `key` distincte à chaque `<form>`.

## Limites assumées (v1)

- Pas de journal d'audit dédié aux actions d'administration (CRUD tenant, rotation de clé) — seul le journal d'audit des vérifications existe (`AuditService`). À ajouter avant production.
- Pas de tests automatisés (Vitest/React Testing Library) pour `apps/admin-web` — vérifié uniquement par build réel + parcours navigateur manuel dans cette session ; à ajouter avant une évolution non triviale de l'UI.
- 2FA TOTP uniquement (pas de clé de sécurité WebAuthn/FIDO2, pas de codes de secours imprimables) — suffisant pour un premier facteur additionnel, à étendre avant un déploiement à grande échelle.
