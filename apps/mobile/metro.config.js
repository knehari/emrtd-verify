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

module.exports = config;
