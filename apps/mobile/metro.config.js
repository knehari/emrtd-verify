// Monorepo pnpm : par défaut Metro ne "watch" que `projectRoot` (apps/mobile), donc son
// file map n'indexe jamais packages/* — les symlinks pnpm vers packages/* dans
// apps/mobile/node_modules/@emrtd-verify/* pointent alors vers des chemins hors des dossiers
// surveillés, et la résolution échoue ("Unable to resolve module") même quand le symlink est
// structurellement correct sur le disque. Fix standard Expo pour monorepo :
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// pnpm installe `expo` comme un lien symbolique vers le store global — sans ceci, Metro résout
// AppEntry.js vers son chemin réel (hors de `projectRoot`) avant de calculer son import relatif
// `../../App`, qui atterrit alors dans le store pnpm au lieu de `apps/mobile/App.tsx` (constaté par
// exécution réelle : `expo export --platform ios` échouait avec "Unable to resolve module ../../App
// from .../node_modules/.pnpm/expo@.../node_modules/expo/AppEntry.js"). Fix documenté pour Metro
// avec des gestionnaires de paquets à liens symboliques (pnpm/Yarn PnP) : préserver les liens
// plutôt que les résoudre vers leur cible réelle.
config.resolver.unstable_enableSymlinks = true;

// Modèle de reconnaissance faciale SFace (src/faceMatch/sfaceModel.ts) embarqué comme ressource.
config.resolver.assetExts.push("onnx");

// Le monorepo contient une AUTRE version de react (18.3.1, utilisée par apps/admin-web et
// apps/tenant-portal en Next.js) en plus de celle que ce projet mobile déclare (18.2.0, requise
// par react-native@0.74.5). `nodeModulesPaths` ci-dessus fait chercher Metro jusqu'à la racine du
// monorepo (nécessaire pour résoudre packages/*), ce qui laisse fuiter cette autre copie de react
// dans le bundle mobile selon le module qui l'importe — constaté par exécution réelle
// (`Cannot read property 'useId' of null` dans `withDevTools(App)`/`useKeepAwake`, deux instances
// de React avec des dispatchers de hooks distincts). Fixe la résolution de `react`/`react-native`
// sur la copie de ce projet, quelle que soit l'origine de l'import.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// Patching expo-keep-awake's useId() call (see scripts/patch-expo-keep-awake.js) only moved the
// crash to the next hook in the same function (useEffect), confirmed by real device logs — every
// hook called from useKeepAwake(), invoked from expo's own withDevTools(App) root wrapper (active
// in every dev build), fails with a null dispatcher, not just useId specifically. expo's
// withDevTools.ios.js already wraps its `require('expo-keep-awake')` in try/catch specifically to
// fall back to a no-op when the package is unavailable — nothing else in this project or in expo
// itself requires expo-keep-awake (confirmed: `grep -rl "expo-keep-awake"` under expo's own
// package only matches withDevTools.*.js). Blocking it here removes the entire crashing code path
// regardless of the underlying dispatcher issue, at the cost of the dev-only "keep screen awake
// while the app is in the foreground during development" convenience.
config.resolver.blockList = [/\/node_modules\/expo-keep-awake\//];

module.exports = config;
