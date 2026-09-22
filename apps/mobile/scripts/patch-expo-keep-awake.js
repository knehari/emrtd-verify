// expo-keep-awake@13.0.2's useKeepAwake() calls React.useId() unconditionally, even when a tag
// is explicitly provided (its result is then discarded via `tag ?? defaultTag`). This crashes
// with "Cannot read property 'useId' of null" when called from expo's own withDevTools wrapper
// (always active in dev builds) -- confirmed by reading the installed source and by reproducing
// the exact failing bundle (`expo export:embed --dev true`), which contains a single, correctly
// deduped copy of react and react-native, ruling out a duplicate-React-copies cause. The crash is
// specific to this one hook call, so it's this package's bug, not a resolver/monorepo issue.
// Patches useKeepAwake so useId() is only evaluated when no tag was given, matching the intended
// behavior (`tag ?? defaultTag`) without an unconditional hook call. Idempotent; runs as this
// workspace package's own postinstall so it's reapplied after every `pnpm install`.
const fs = require("fs");

const BUGGY = "    const defaultTag = useId();\n    const tagOrDefault = tag ?? defaultTag;\n";
const FIXED = "    const tagOrDefault = tag ?? useId();\n";

let resolvedPath;
try {
  // pnpm's strict node_modules doesn't hoist expo-keep-awake into this workspace package's own
  // node_modules (it's not a direct dependency here, only of `expo` itself) -- resolve it the
  // same way `expo`'s own withDevTools.ios.js does, starting the module search from `expo`.
  const expoDir = require.resolve("expo/package.json");
  resolvedPath = require.resolve("expo-keep-awake/build/index.js", { paths: [expoDir] });
} catch (error) {
  console.warn("[patch-expo-keep-awake] expo-keep-awake not installed, skipping.");
  process.exit(0);
}

const contents = fs.readFileSync(resolvedPath, "utf8");

if (contents.includes(FIXED)) {
  console.log("[patch-expo-keep-awake] already patched.");
  process.exit(0);
}

if (!contents.includes(BUGGY)) {
  console.warn(
    "[patch-expo-keep-awake] expected pattern not found (package version may have changed) -- leaving file untouched."
  );
  process.exit(0);
}

fs.writeFileSync(resolvedPath, contents.replace(BUGGY, FIXED));
console.log(`[patch-expo-keep-awake] patched ${resolvedPath}`);
