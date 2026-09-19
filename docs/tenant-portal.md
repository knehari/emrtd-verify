# Portail tenant (tiers)

## Principe

Une interface web permettant à un tenant (un client KYC intégré à la plateforme, voir [kyc-integration.md](kyc-integration.md)) de consulter ses propres vérifications et le statut consolidé de ses "clients" (personnes vérifiées), sans jamais accéder aux données d'un autre tenant — voir [roadmap.md](roadmap.md) pour la décision multi-tenant retenue. Le frontend (`apps/tenant-portal`, Next.js 14 App Router + Tailwind + Radix UI + React Query, palette teal — distincte visuellement de [apps/admin-web](admin-web.md)) est implémenté : pages Connexion, Tableau de bord (compteurs par statut + répartition), Clients (liste paginée/filtrée des `VerifiedPerson`, détail, changement de statut y compris mise sous surveillance), Vérifications (revue de son propre périmètre), Paramètres (profil en lecture seule). Vérifié par un vrai build de production (`next build`) et un parcours utilisateur réel en navigateur — voir "Vérification" ci-dessous.

## Isolation multi-tenant

**Propriété de sécurité centrale** : chaque requête `/portal/*` est scopée au `kycClientId` porté par le jeton de session du tenant appelant (`TenantAuthGuard`, voir `tenant-auth.guard.ts`) — jamais un paramètre venant de l'URL ou du corps de la requête. Un accès à une ressource d'un autre tenant renvoie systématiquement `404` (jamais `403`), pour ne pas confirmer l'existence de la ressource — même principe que `GET /v1/verifications/:id` côté API KYC. Vérifié par des tests d'intégration réels (deux tenants isolés, tentative de lecture/écriture croisée).

## Authentification

Session par cookie httpOnly (`tenant_session`), signé (JWT, `TENANT_JWT_SECRET` — secret distinct de `ADMIN_JWT_SECRET`), 12h de validité — voir `TenantAuthService`/`TenantAuthController`.

- `POST /portal/auth/login` — `{ email, password }`. Limité à 5 tentatives/minute/IP.
- `POST /portal/auth/logout`
- `GET /portal/auth/me`

**Provisionnement** : un compte tenant est créé par un administrateur interne (jamais en self-service — la création d'un tenant reste une décision commerciale/sécurité humaine, voir [admin-web.md](admin-web.md)) : `pnpm --filter @emrtd-verify/api create-tenant-user -- --kyc-client-id=... --email=... --role=OWNER|MEMBER` (voir `scripts/create-tenant-user.ts`).

## "Clients" (VerifiedPerson)

Vue consolidée d'une personne au travers de plusieurs tentatives de vérification pour ce tenant — voir `VerifiedPerson` (schema.prisma) et `VerifiedPersonService`. Rapprochement par clé naturelle hachée (documentType+issuingCountry+documentNumber+dateOfBirth, jamais stockée en clair).

**Statuts** : `VERIFIED` / `UNVERIFIED` / `PENDING_REVIEW` (calculés automatiquement à partir du verdict de la dernière vérification) et `WATCHLIST` (toujours une décision humaine explicite, jamais écrasée automatiquement par une nouvelle vérification).

- `GET /portal/verified-persons/stats` — compteurs par statut (alimente le tableau de bord).
- `GET /portal/verified-persons?page=&pageSize=&status=` — liste paginée/filtrée.
- `GET /portal/verified-persons/:id` — détail.
- `PATCH /portal/verified-persons/:id` — `{ status, watchlistReason? }` (`watchlistReason` requis si `status = WATCHLIST`).

**Limite assumée** : le rapprochement par documentNumber signifie qu'un renouvellement de document (nouveau numéro) crée une nouvelle fiche plutôt que de rattacher l'historique à l'ancienne — pas de résolution d'identité biométrique inter-documents en v1.

## Revue des vérifications (périmètre du tenant)

Voir `TenantVerificationsController`/`TenantVerificationsService` — `GET /portal/verifications?page=&pageSize=&verdict=`, `GET /portal/verifications/:verificationId`. Le `VerificationResult` restitué est déjà celui filtré par `KycClient.allowedFields` au moment de la vérification (même contrat que `GET /v1/verifications/:id`) — aucune donnée supplémentaire n'est exposée ici.

## Rétention des données et VerifiedPerson

**Tension assumée** : `VerifiedPerson` est conçu pour survivre à la purge de rétention des `VerificationRecord` individuels (`DATA_RETENTION_DAYS`, voir [gdpr-compliance.md](gdpr-compliance.md)) — la relation `VerificationRecord.verifiedPersonId` est `onDelete: SetNull`, donc purger une vérification ne supprime jamais la fiche consolidée, seulement son lien vers le détail complet. Ce choix est nécessaire pour que la fonctionnalité "à surveiller" ait un sens dans la durée, mais élargit la durée de conservation effective d'un identifiant de rapprochement (haché) au-delà de `DATA_RETENTION_DAYS`. **Non traité en v1** : aucune politique de purge/anonymisation dédiée à `VerifiedPerson` — à documenter dans une AIPD complète avant production (voir [roadmap.md](roadmap.md)).

## Vérification

- **Typecheck + build de production** réels (`pnpm --filter @emrtd-verify/tenant-portal exec tsc --noEmit`, `next build`) — 7 routes compilées sans erreur.
- **Parcours réel en navigateur** (Chromium headless) contre l'API réelle et un Postgres local (tenant `acme-bank`, quatre `VerifiedPerson` synthétiques couvrant les quatre statuts) : connexion (cookie de session posé), tableau de bord affichant les vrais compteurs, page Clients (liste, filtre par statut, détail, changement de statut avec rafraîchissement React Query), page Vérifications (filtre par verdict, état vide correct en l'absence de vérification pour ce tenant), page Paramètres (profil réel : email, rôle, `clientId`), déconnexion. Aucune erreur ni avertissement dans la console du navigateur sur l'ensemble du parcours.
- **Bug réel trouvé et corrigé en cours de vérification** : la boîte de dialogue de détail client (`ClientDetailDialog`) initialisait son état `status`/`watchlistReason` une seule fois à partir de la prop `person`, capturée à `null` au premier montage (le composant est monté une fois pour toutes, pas recréé à l'ouverture). Le correctif consistait à ouvrir/synchroniser dans `Dialog.onOpenChange`, mais ce callback Radix ne se déclenche pas pour un changement programmatique de la prop `open` pilotée par le parent — seulement pour les interactions internes (Échap, clic extérieur). Résultat observé : ouvrir la fiche d'un client `WATCHLIST` affichait "En attente" au lieu de "À surveiller", avec le motif de surveillance vide. Corrigé en ajoutant `key={selected?.id ?? "none"}` sur `<ClientDetailDialog>` (`apps/tenant-portal/src/app/(dashboard)/clients/page.tsx`) pour forcer un remontage — donc une réinitialisation correcte de l'état — à chaque changement de client sélectionné. Revérifié en navigateur après correction : statut et motif corrects pour plusieurs clients successifs, et la mutation de changement de statut confirmée fonctionnelle de bout en bout (PATCH réel, tableau rafraîchi).

## Limites assumées (v1)

- Pas de self-service (invitation de collègues, régénération de clé API) côté tenant — tout passe par l'administrateur interne (décision retenue, voir [roadmap.md](roadmap.md)).
- Pas de changement de mot de passe en libre-service ni de 2FA.
- Pas de tests automatisés (Vitest/React Testing Library) pour `apps/tenant-portal` — vérifié uniquement par build réel + parcours navigateur manuel dans cette session ; à ajouter avant une évolution non triviale de l'UI.
