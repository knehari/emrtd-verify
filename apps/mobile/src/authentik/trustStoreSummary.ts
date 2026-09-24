/**
 * Résumé RÉEL du magasin CSCA embarqué (pki/defaultCscaBundle.json) pour les écrans « Pays » et
 * Réglages — remplace les chiffres de maquette du design (qui annonçaient par exemple 5 ancres pour
 * l'Algérie alors que le magasin n'en contient aucune). Calculé une seule fois : le fichier est figé
 * à la compilation.
 */
import defaultCscaAnchorsJson from "../pki/defaultCscaBundle.json";
import { toAlpha2CountryCode } from "@emrtd-verify/emrtd-core";
import { COUNTRY_NAMES, flagEmoji } from "./countryNames";

interface EmbeddedAnchor {
  countryCode: string;
  notBefore: string;
  notAfter: string;
}

const anchors = defaultCscaAnchorsJson as EmbeddedAnchor[];

export interface CountryRow {
  code: string;
  flag: string;
  name: string;
  anchors: string;
}

export function embeddedCountryRows(lang: "fr" | "en", anchorsWord: string): CountryRow[] {
  const now = new Date().toISOString();
  const byCountry = new Map<string, { total: number; valid: number }>();
  for (const a of anchors) {
    const entry = byCountry.get(a.countryCode) ?? { total: 0, valid: 0 };
    entry.total += 1;
    if (now >= a.notBefore && now <= a.notAfter) entry.valid += 1;
    byCountry.set(a.countryCode, entry);
  }
  return [...byCountry.entries()]
    .map(([code, { total, valid }]) => ({
      code,
      flag: flagEmoji(code),
      name: COUNTRY_NAMES[toAlpha2CountryCode(code) ?? code]?.[lang === "fr" ? 0 : 1] ?? code,
      anchors: `${total} ${anchorsWord}${valid < total ? ` (${valid} ${lang === "fr" ? "valides" : "valid"})` : ""}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

/** Chiffres réels du magasin embarqué, pour les libellés à gabarit ({countries}, {anchors}). */
export const embeddedStoreStats = {
  anchors: anchors.length,
  countries: new Set(anchors.map((a) => toAlpha2CountryCode(a.countryCode) ?? a.countryCode)).size,
};

export function fillStoreStats(template: string): string {
  return template
    .replace("{countries}", String(embeddedStoreStats.countries))
    .replace("{anchors}", String(embeddedStoreStats.anchors));
}

export function embeddedStoreRows(lang: "fr" | "en"): [string, string][] {
  const now = new Date().toISOString();
  const valid = anchors.filter((a) => now >= a.notBefore && now <= a.notAfter).length;
  return lang === "fr"
    ? [
        ["Ancres CSCA", String(embeddedStoreStats.anchors)],
        ["Valides aujourd'hui", String(valid)],
        ["Pays couverts", String(embeddedStoreStats.countries)],
        ["Sources", "Master List ICAO · Master Lists nationales PKD · Master List BSI (DE)"],
      ]
    : [
        ["CSCA anchors", String(embeddedStoreStats.anchors)],
        ["Valid today", String(valid)],
        ["Countries covered", String(embeddedStoreStats.countries)],
        ["Sources", "ICAO Master List · PKD national Master Lists · BSI Master List (DE)"],
      ];
}
