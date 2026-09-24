/**
 * Résumé RÉEL du magasin CSCA embarqué (pki/defaultCscaBundle.json) pour les écrans « Pays » et
 * Réglages — remplace les chiffres de maquette du design (qui annonçaient par exemple 5 ancres pour
 * l'Algérie alors que le magasin n'en contient aucune). Calculé une seule fois : le fichier est figé
 * à la compilation.
 */
import defaultCscaAnchorsJson from "../pki/defaultCscaBundle.json";
import {
  base64ToBytes,
  certificateSerialNumberHex,
  describeCertificateKey,
  describeSignatureAlgorithm,
  distinguishedNameToString,
  parseCertificate,
  sameCountry,
  sha256Hex,
  toAlpha2CountryCode,
  toAlpha3CountryCode,
} from "@emrtd-verify/emrtd-core";
import { COUNTRY_NAMES } from "./countryNames";

interface EmbeddedAnchor {
  countryCode: string;
  certificateDerBase64: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  source: string;
}

const anchors = defaultCscaAnchorsJson as EmbeddedAnchor[];

export interface CountryRow {
  code: string;
  name: string;
  anchors: string;
  /** Nom FR + EN, alpha-2 et alpha-3, en minuscules sans accents — voir `matchesCountrySearch`. */
  searchText: string;
}

/** Minuscules sans accents, sans dépendre de `String.prototype.normalize` (Hermes selon la build). */
export function foldForSearch(text: string): string {
  const table: Record<string, string> = {
    à: "a", â: "a", ä: "a", á: "a", ã: "a", å: "a", ç: "c", é: "e", è: "e", ê: "e", ë: "e",
    î: "i", ï: "i", í: "i", ì: "i", ô: "o", ö: "o", ó: "o", ò: "o", õ: "o", ø: "o", û: "u",
    ù: "u", ü: "u", ú: "u", ÿ: "y", ý: "y", ñ: "n", œ: "oe", æ: "ae", "’": "'",
  };
  return text.toLowerCase().replace(/[^\u0000-\u007f]/g, (ch) => table[ch] ?? ch);
}

export function countryName(code: string, lang: "fr" | "en"): string {
  return COUNTRY_NAMES[toAlpha2CountryCode(code) ?? code]?.[lang === "fr" ? 0 : 1] ?? code;
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
    .map(([code, { total, valid }]) => {
      const alpha2 = toAlpha2CountryCode(code) ?? code;
      const names = COUNTRY_NAMES[alpha2] ?? [code, code];
      return {
        code,
        name: countryName(code, lang),
        anchors: `${total} ${anchorsWord}${valid < total ? ` (${valid} ${lang === "fr" ? "valides" : "valid"})` : ""}`,
        searchText: foldForSearch([code, alpha2, toAlpha3CountryCode(code) ?? "", names[0], names[1]].join(" ")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

/** Chaque mot saisi doit apparaître (début de mot ou code) : « alg », « DZA », « royaume uni »… */
export function matchesCountrySearch(row: CountryRow, query: string): boolean {
  const words = foldForSearch(query).split(/[\s,.'-]+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystackWords = row.searchText.split(/[\s,.'-]+/);
  return words.every((w) => haystackWords.some((h) => h.startsWith(w)));
}

export type CscaStatus = "valid" | "expired" | "future";

export interface CscaDetail {
  key: string;
  commonName: string;
  organisation: string;
  subject: string;
  issuer: string;
  /**
   * Certificat de lien (Doc 9303 Part 12 §5.1.1 : nouvelle clé signée par l'ancienne) — reconnu à
   * son Authority Key Identifier différent de son Subject Key Identifier, le DN restant souvent
   * identique d'une génération à l'autre.
   */
  isLink: boolean;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  status: CscaStatus;
  source: string;
  keyAlgorithm: string;
  signatureAlgorithm: string;
  /** SHA-256 du certificat DER, en hexadécimal majuscule groupé par 2. */
  fingerprint: string;
}

type ParsedCertificate = ReturnType<typeof parseCertificate>;

function extensionKeyId(cert: ParsedCertificate, oid: string): string | undefined {
  const parsed = cert.extensions?.find((e) => e.extnID === oid)?.parsedValue as
    | { valueBlock?: { valueHexView?: Uint8Array }; keyIdentifier?: { valueBlock: { valueHexView: Uint8Array } } }
    | undefined;
  const bytes = oid === "2.5.29.35" ? parsed?.keyIdentifier?.valueBlock.valueHexView : parsed?.valueBlock?.valueHexView;
  return bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : undefined;
}

function rdnValue(dn: string, attr: string): string {
  return dn
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${attr}=`))
    .map((part) => part.slice(attr.length + 1))
    .join(", ");
}

/**
 * Tous les CSCA embarqués d'un pays, décodés à la demande (seulement à l'ouverture de sa fiche) :
 * valides d'abord, puis du plus récent au plus ancien.
 */
export function embeddedCountryCscas(code: string, now: Date = new Date()): CscaDetail[] {
  const nowIso = now.toISOString();
  const rank: Record<CscaStatus, number> = { valid: 0, future: 1, expired: 2 };
  return anchors
    .filter((a) => sameCountry(a.countryCode, code))
    .map((a) => {
      const der = base64ToBytes(a.certificateDerBase64);
      const cert = parseCertificate(der);
      const subject = distinguishedNameToString(cert.subject);
      const issuer = distinguishedNameToString(cert.issuer);
      const status: CscaStatus = nowIso < a.notBefore ? "future" : nowIso > a.notAfter ? "expired" : "valid";
      return {
        key: a.certificateDerBase64.slice(-24),
        commonName: rdnValue(subject, "CN") || subject,
        organisation: [rdnValue(subject, "O"), rdnValue(subject, "OU")].filter(Boolean).join(" · "),
        subject,
        issuer,
        isLink: (() => {
          const ski = extensionKeyId(cert, "2.5.29.14");
          const aki = extensionKeyId(cert, "2.5.29.35");
          return subject !== issuer || (ski !== undefined && aki !== undefined && ski !== aki);
        })(),
        serialNumber: certificateSerialNumberHex(cert).toUpperCase(),
        notBefore: a.notBefore,
        notAfter: a.notAfter,
        status,
        source: a.source,
        keyAlgorithm: describeCertificateKey(cert),
        signatureAlgorithm: describeSignatureAlgorithm(cert),
        fingerprint: (sha256Hex(der).toUpperCase().match(/../g) ?? []).join(":"),
      };
    })
    .sort((x, y) => rank[x.status] - rank[y.status] || y.notAfter.localeCompare(x.notAfter));
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
