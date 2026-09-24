/**
 * Génère src/authentik/flagSvgs.ts (drapeaux SVG des pays affichés par l'app) depuis le paquet
 * country-flag-icons (MIT, © catamphetamine), format 3:2 — pas de dépendance d'exécution : seuls les
 * drapeaux utiles sont copiés dans le dépôt.
 *
 * Usage : npm i --no-save country-flag-icons@1.6.20 && node scripts/generate-flag-svgs.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const flags = require("country-flag-icons/string/3x2");

const namesSource = fs.readFileSync(path.join(__dirname, "../src/authentik/countryNames.ts"), "utf-8");
const wanted = new Set([...namesSource.matchAll(/^\s+([A-Z]{2}): \[/gm)].map((m) => m[1]).concat(["EU", "XK"]));

const entries = [...wanted]
  .filter((code) => flags[code])
  .sort()
  // "slice" : le cadre 26 × 18 du design n'est pas tout à fait en 3:2, on remplit sans bandes vides.
  .map((code) => `  ${code}: ${JSON.stringify(flags[code].replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" '))},`);

const header = `/**
 * Drapeaux SVG (format 3:2) — GÉNÉRÉ par scripts/generate-flag-svgs.cjs depuis country-flag-icons
 * 1.6.20 (licence MIT, © catamphetamine, https://gitlab.com/catamphetamine/country-flag-icons).
 * Ne pas modifier à la main.
 */
export const FLAG_SVGS: Record<string, string> = {
`;
fs.writeFileSync(path.join(__dirname, "../src/authentik/flagSvgs.ts"), `${header}${entries.join("\n")}\n};\n`);
console.log(`${entries.length} drapeaux écrits.`);
