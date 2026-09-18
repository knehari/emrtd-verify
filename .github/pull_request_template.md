## Résumé

<!-- Que fait cette PR et pourquoi ? -->

## Périmètre touché

- [ ] Chaîne de confiance PKI (`packages/pki-trust`)
- [ ] Parsing MRZ/LDS/SOD (`packages/emrtd-core`)
- [ ] Reconnaissance faciale (`services/face-match`)
- [ ] API / KYC (`apps/api`)
- [ ] Mobile / NFC (`apps/mobile`)
- [ ] Documentation uniquement

## Checklist

- [ ] Tests ajoutés/mis à jour
- [ ] Toute règle issue d'une norme (ICAO Doc 9303, RGPD) référence sa section exacte
- [ ] Aucune donnée biométrique ou clé privée n'est committée
- [ ] `pnpm lint && pnpm typecheck && pnpm test` passent localement
