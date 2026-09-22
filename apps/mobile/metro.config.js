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

module.exports = config;
