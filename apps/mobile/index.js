// Point d'entrée local — remplace la valeur par défaut `expo/AppEntry.js` du champ `main` de
// package.json. Nécessaire avec pnpm : `expo/AppEntry.js` est un lien symbolique vers le store
// global pnpm, et son propre import relatif `../../App` se résout alors depuis le chemin RÉEL du
// store (hors du projet) plutôt que depuis `apps/mobile/` — constaté par exécution réelle
// (`expo export --platform ios` échouait avec "Unable to resolve module ../../App from
// .../node_modules/.pnpm/expo@.../node_modules/expo/AppEntry.js"), même avec
// `resolver.unstable_enableSymlinks` activé dans metro.config.js. Ce fichier vit directement dans
// `apps/mobile/` (jamais symlinké), donc son propre `./App` se résout correctement.
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
