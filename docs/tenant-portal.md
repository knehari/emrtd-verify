# Portail tenant (tiers)

## Principe

Une interface web permettant à un tenant (un client KYC intégré à la plateforme, voir [kyc-integration.md](kyc-integration.md)) de consulter ses propres vérifications et le statut consolidé de ses "clients" (personnes vérifiées), sans jamais accéder aux données d'un autre tenant — voir [roadmap.md](roadmap.md) pour la décision multi-tenant retenue. Le frontend (`apps/tenant-portal`, Next.js) n'est pas encore construit — ce document décrit la surface d'API backend déjà implémentée et testée (`apps/api/src/modules/tenant-auth/`, `apps/api/src/modules/tenant-api/`).

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

## Limites assumées (v1)

- Pas de self-service (invitation de collègues, régénération de clé API) côté tenant — tout passe par l'administrateur interne (décision retenue, voir [roadmap.md](roadmap.md)).
- Pas de changement de mot de passe en libre-service ni de 2FA.
- `apps/tenant-portal` (frontend Next.js) reste à construire.
