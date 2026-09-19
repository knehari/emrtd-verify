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

Voir [roadmap.md](roadmap.md) Phase 4 — dashboard provisionné dans `docker-compose.yml`, branché sur `/metrics` (API et worker). L'interface d'administration expose un simple lien vers l'URL Grafana (pas d'authentification unifiée SSO en v1 — limite assumée).

## Vérification

- **Typecheck + build de production** réels (`pnpm --filter @emrtd-verify/admin-web exec tsc --noEmit`, `next build`) — 7 routes compilées sans erreur.
- **Parcours réel en navigateur** (Chromium headless) contre l'API réelle et un Postgres local : connexion (cookie de session posé), tableau de bord affichant les vrais compteurs, création d'un tenant avec révélation de clé API une seule fois, rafraîchissement automatique de la liste (React Query), page Vérifications (filtres, état vide correct), page Administrateurs (RBAC — un SUPPORT ne peut pas écrire côté API ; côté UI, seul un SUPER_ADMIN voit la page). Aucune erreur ni avertissement dans la console du navigateur sur l'ensemble du parcours.

## Limites assumées (v1)

- Pas de changement de mot de passe en libre-service ni de 2FA — à construire avant un déploiement multi-opérateurs réel.
- Pas de journal d'audit dédié aux actions d'administration (CRUD tenant, rotation de clé) — seul le journal d'audit des vérifications existe (`AuditService`). À ajouter avant production.
- Pas de tests automatisés (Vitest/React Testing Library) pour `apps/admin-web` — vérifié uniquement par build réel + parcours navigateur manuel dans cette session ; à ajouter avant une évolution non triviale de l'UI.
