# apps/mobile

Application Expo/React Native chargée de la capture des données du document : lecture NFC de la puce (BAC/PACE) et capture de la photo vivante pour la reconnaissance faciale.

**Principe de sécurité** : ce client ne rend jamais lui-même un verdict d'authenticité. Il transmet les données brutes lues (DG + SOD, capture vivante) à `apps/api`, seule source de vérité — voir [docs/architecture.md](../../docs/architecture.md).

## Lecture NFC

`src/nfc/emrtdReader.ts` lit la puce au-dessus de `react-native-nfc-manager` : EF.CardAccess, puis PACE si la puce l'annonce (sinon BAC), puis EF.SOD et les DG sous messagerie sécurisée — protocoles dans `packages/emrtd-core/src/nfc/` (voir [docs/roadmap.md](../../docs/roadmap.md) Phase 4). Sur iOS, la lecture exige un compte Apple Developer payant (capacité *NFC Tag Reading*) ; l'entitlement `TAG` et les AID eMRTD (`com.apple.developer.nfc.readersession.iso7816.select-identifiers`) sont ajoutés par le plugin Expo de `react-native-nfc-manager` déclaré dans `app.json`.

## Démarrer

```bash
pnpm install
pnpm --filter @emrtd-verify/mobile dev
```
