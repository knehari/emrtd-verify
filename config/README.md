# config/extended-trust-store.json

Magasin de confiance étendu pour les CSCA de pays hors ICAO PKD / PKD nationale accessible. Vide par défaut.

**Ne pas ajouter d'entrée sans suivre le processus décrit dans [`docs/pki-trust-model.md`](../docs/pki-trust-model.md)** : provenance tracée, revue à deux personnes, niveau de confiance jamais `high`, `reviewBeforeDate` obligatoire. Le schéma attendu est `CscaTrustAnchor[]` (voir `packages/pki-trust/src/trustAnchor.ts`).
