# Contribuer

## Prérequis

- Node.js ≥ 20, pnpm ≥ 9
- Python ≥ 3.11 (pour `services/face-match`)
- Docker + Docker Compose (pour l'environnement de développement complet)

## Démarrage

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm dev
```

## Structure

Ce dépôt est un monorepo pnpm/Turborepo. Chaque package/app a son propre `package.json`, `tsconfig.json` et ses tests. Voir [docs/architecture.md](docs/architecture.md) avant de contribuer à un module de confiance PKI ou de cryptographie — ces modules doivent rester strictement conformes à l'ICAO Doc 9303.

## Style

- TypeScript strict (`strict: true`), pas de `any` non justifié.
- Toute règle métier issue d'une norme (ICAO Doc 9303, RGPD) doit référencer la section exacte de la norme dans un commentaire.
- Les modules touchant à la cryptographie ou aux données biométriques nécessitent une revue par au moins deux personnes.

## Tests

```bash
pnpm test        # tous les packages/apps TypeScript
pnpm --filter face-match test   # service Python
```

## Commits

Convention [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`...).
