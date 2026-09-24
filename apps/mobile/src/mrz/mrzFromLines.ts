/**
 * Transforme les lignes de texte reconnues en direct par Apple Vision (module natif
 * `modules/mrz-scanner`) en une lecture MRZ validée. Aucune lecture n'est acceptée sans que les
 * chiffres de contrôle ICAO 9303 des trois champs de la clé BAC (numéro, naissance, expiration)
 * soient corrects — les corrections ci-dessous ne font que rattraper les confusions typiques de l'OCR
 * avant cette vérification, jamais la contourner.
 */
import { parseMrzTd1, parseMrzTd3, verifyCheckDigit, MrzParseError, type ParsedMrz } from "@emrtd-verify/emrtd-core";

/** Ligne détectée, coordonnées normalisées [0,1] dans la vue caméra, origine en haut à gauche. */
export interface DetectedLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MrzRead {
  parsed: ParsedMrz;
  /** Mêmes formats que la saisie manuelle (MrzFormState) : numéro sans '<', dates AAMMJJ. */
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  /** Identifie une lecture pour le vote sur plusieurs images. */
  key: string;
}

export type MrzLinesAnalysis =
  | { kind: "mrz"; read: MrzRead }
  /** Ancienne CNI française (avant août 2021) : MRZ non ICAO (2 × 36) et pas de puce. */
  | { kind: "legacy-fr-id" }
  | { kind: "none" };

export function normalizeMrzText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/«/g, "<<")
    .replace(/[‹〈(\[{]/g, "<")
    .replace(/[^A-Z0-9<]/g, "");
}

export function isMrzLikeText(raw: string): boolean {
  const text = normalizeMrzText(raw);
  return text.length >= 20 && text.includes("<<");
}

/** Regroupe les morceaux de texte par ligne visuelle (Vision coupe parfois une ligne MRZ en deux). */
export function groupIntoRows(lines: DetectedLine[]): string[] {
  const sorted = [...lines].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows: DetectedLine[][] = [];
  for (const line of sorted) {
    const current = rows[rows.length - 1];
    if (current) {
      const ref = current[0];
      const sameRow = Math.abs(ref.y + ref.height / 2 - (line.y + line.height / 2)) < Math.max(ref.height, line.height) * 0.5;
      if (sameRow) {
        current.push(line);
        continue;
      }
    }
    rows.push([line]);
  }
  return rows.map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((l) => normalizeMrzText(l.text))
      .join(""),
  );
}

function fitLength(row: string, target: number): string | null {
  if (row.length === target) return row;
  if (row.length > target) {
    return /^<+$/.test(row.slice(target)) ? row.slice(0, target) : null;
  }
  return target - row.length <= 2 ? row + "<".repeat(target - row.length) : null;
}

// Schéma par position : d = chiffre attendu, a = lettre (ou '<'), x = alphanumérique.
const TD3_LINE1 = "a".repeat(44);
const TD3_LINE2 = "x".repeat(9) + "d" + "aaa" + "dddddd" + "d" + "a" + "dddddd" + "d" + "x".repeat(14) + "d" + "d";
const TD1_LINE1 = "aaaaa" + "x".repeat(9) + "d" + "x".repeat(15);
const TD1_LINE2 = "dddddd" + "d" + "a" + "dddddd" + "d" + "aaa" + "x".repeat(11) + "d";
const TD1_LINE3 = "a".repeat(30);

const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8" };
const TO_ALPHA: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
const AMBIGUOUS: Record<string, string> = { ...TO_DIGIT, ...TO_ALPHA };

function coerce(line: string, schema: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (schema[i] === "d") out += TO_DIGIT[c] ?? c;
    else if (schema[i] === "a") out += TO_ALPHA[c] ?? c;
    else out += c;
  }
  return out;
}

/**
 * Le numéro de document mélange lettres et chiffres : impossible d'y deviner O/0 ou I/1 par le
 * schéma. On essaie les variantes ambiguës (le moins de substitutions d'abord) jusqu'à ce que le
 * chiffre de contrôle du champ soit juste.
 */
function repairAlphanumericField(line: string, start: number, length: number, checkIndex: number): string {
  const field = line.slice(start, start + length);
  const check = line[checkIndex];
  if (verifyCheckDigit(field, check)) return line;
  const positions = [...field].map((c, i) => (AMBIGUOUS[c] ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0 || positions.length > 8) return line;
  const masks = Array.from({ length: (1 << positions.length) - 1 }, (_, i) => i + 1).sort(
    (a, b) => popcount(a) - popcount(b),
  );
  for (const mask of masks) {
    const chars = [...field];
    positions.forEach((pos, bit) => {
      if (mask & (1 << bit)) chars[pos] = AMBIGUOUS[chars[pos]];
    });
    const candidate = chars.join("");
    if (verifyCheckDigit(candidate, check)) {
      return line.slice(0, start) + candidate + line.slice(start + length);
    }
  }
  return line;
}

function popcount(n: number): number {
  let count = 0;
  for (let v = n; v; v &= v - 1) count++;
  return count;
}

function toRead(parsed: ParsedMrz, dateOfBirth: string, dateOfExpiry: string): MrzRead | null {
  const v = parsed.validation;
  if (!v.documentNumberValid || !v.dateOfBirthValid || !v.dateOfExpiryValid) return null;
  const documentNumber = parsed.identity.documentNumber;
  return { parsed, documentNumber, dateOfBirth, dateOfExpiry, key: `${documentNumber}|${dateOfBirth}|${dateOfExpiry}` };
}

function tryParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MrzParseError) return null;
    throw e;
  }
}

function readTd3(row1: string, row2: string): MrzRead | null {
  const r1 = fitLength(row1, 44);
  const r2 = fitLength(row2, 44);
  if (!r1 || !r2 || !r1.startsWith("P")) return null;
  const line1 = coerce(r1, TD3_LINE1);
  const line2 = repairAlphanumericField(coerce(r2, TD3_LINE2), 0, 9, 9);
  const parsed = tryParse(() => parseMrzTd3(line1, line2));
  return parsed && toRead(parsed, line2.slice(13, 19), line2.slice(21, 27));
}

function readTd1(row1: string, row2: string, row3: string): MrzRead | null {
  const r1 = fitLength(row1, 30);
  const r2 = fitLength(row2, 30);
  const r3 = fitLength(row3, 30);
  if (!r1 || !r2 || !r3 || !/^[IAC]/.test(r1)) return null;
  const line1 = repairAlphanumericField(coerce(r1, TD1_LINE1), 5, 9, 14);
  const line2 = coerce(r2, TD1_LINE2);
  const line3 = coerce(r3, TD1_LINE3);
  const parsed = tryParse(() => parseMrzTd1(line1, line2, line3));
  return parsed && toRead(parsed, line2.slice(0, 6), line2.slice(8, 14));
}

export function analyzeMrzLines(lines: DetectedLine[]): MrzLinesAnalysis {
  const rows = groupIntoRows(lines);
  for (let i = 0; i + 2 < rows.length; i++) {
    const read = readTd1(rows[i], rows[i + 1], rows[i + 2]);
    if (read) return { kind: "mrz", read };
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    const read = readTd3(rows[i], rows[i + 1]);
    if (read) return { kind: "mrz", read };
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    const first = fitLength(rows[i], 36);
    if (first?.startsWith("IDFRA") && fitLength(rows[i + 1], 36)) return { kind: "legacy-fr-id" };
  }
  return { kind: "none" };
}

/**
 * Vote sur plusieurs images : une lecture n'est retenue qu'une fois vue `required` fois parmi les
 * `window` dernières analyses. Une confusion OCR qui passerait par hasard un chiffre de contrôle
 * (1 chance sur 10 par champ) ne se reproduit presque jamais à l'identique d'une image à l'autre.
 */
export class MrzConsensus {
  private history: string[] = [];

  constructor(
    private readonly required = 2,
    private readonly window = 6,
  ) {}

  push(read: MrzRead | null): MrzRead | null {
    this.history.push(read ? read.key : "");
    if (this.history.length > this.window) this.history.shift();
    if (!read) return null;
    return this.history.filter((k) => k === read.key).length >= this.required ? read : null;
  }

  reset(): void {
    this.history = [];
  }
}
