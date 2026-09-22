// DOIT rester le tout premier import : react-native-get-random-values installe le polyfill
// crypto.getRandomValues avant que quoi que ce soit d'autre (notamment @emrtd-verify/emrtd-core,
// dont bac.ts en a besoin pour générer RND.IFD/K.IFD) ne puisse l'utiliser — React Native/Hermes
// ne l'expose pas nativement, contrairement à Node/aux navigateurs.
import "react-native-get-random-values";
import React from "react";
import { AuthentikApp } from "./src/authentik/AuthentikApp";

/**
 * Racine de l'app — premier PoC de l'UX "Authentik" livrée par Claude Design (voir
 * `apps/mobile/src/authentik/README.md`). Parcours simulé par minuteurs (comme le prototype de
 * design lui-même, voir son README §2) : `ScanScreen`/`LivenessChallengeScreen` (lecture NFC/BAC
 * réelle, liveness active réelle — voir src/screens/, src/nfc/, src/liveness/) restent
 * implémentées et testées séparément mais ne sont pas encore branchées à cette UI ; les brancher
 * est le prochain incrément (remplacer les minuteurs de `src/authentik/state.ts` par de vrais
 * appels à `emrtdReader`/`LivenessChallengeScreen`/`computeLocalVerification`).
 */
export default function App() {
  return <AuthentikApp />;
}
