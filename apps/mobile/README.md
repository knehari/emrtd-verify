# apps/mobile

Application Expo/React Native chargée de la capture des données du document : lecture NFC de la puce (BAC/PACE) et capture de la photo vivante pour la reconnaissance faciale.

**Principe de sécurité** : ce client ne rend jamais lui-même un verdict d'authenticité. Il transmet les données brutes lues (DG + SOD, capture vivante) à `apps/api`, seule source de vérité — voir [docs/architecture.md](../../docs/architecture.md).

## Lecture NFC

`src/nfc/emrtdReader.ts` définit l'interface de lecture BAC/PACE (Doc 9303 Part 11 §4 et §9) au-dessus de `react-native-nfc-manager`. L'implémentation de la dérivation de clé BAC (à partir du numéro de document, de la date de naissance et de la date d'expiration lues sur la MRZ imprimée) et du protocole PACE reste à faire — voir [docs/roadmap.md](../../docs/roadmap.md) Phase 4.

## Démarrer

```bash
pnpm install
pnpm --filter @emrtd-verify/mobile dev
```
