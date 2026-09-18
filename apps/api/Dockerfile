FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# Le client Prisma est généré à part (jamais via un hook postinstall, désactivé par défaut par
# pnpm pour raisons de sécurité) : indispensable avant `nest build` puisque PrismaService importe
# les types générés depuis @prisma/client.
RUN pnpm --filter @emrtd-verify/api exec prisma generate --schema=./apps/api/prisma/schema.prisma
RUN pnpm --filter @emrtd-verify/api... build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
# `apps/api/dist/main.js` (compilé par `nest build`/tsc — seul outil qui émet correctement les
# métadonnées de décorateurs `emitDecoratorMetadata` dont dépend l'injection de dépendances
# NestJS) est exécuté avec `-r ts-node/register/transpile-only` : ce hook ne sert PAS à notre
# propre code (déjà compilé en JS) mais à transpiler à la volée les packages du workspace
# (@emrtd-verify/pki-trust, @emrtd-verify/emrtd-core, @emrtd-verify/shared-types), qui exposent
# leur source TypeScript directement (`main` pointe vers `src/index.ts`, pas un `dist/` — voir
# leurs package.json). `--transpile-only` est sûr ici : ces packages n'utilisent aucun décorateur.
WORKDIR /app/apps/api
CMD ["node", "-r", "ts-node/register/transpile-only", "dist/main.js"]
