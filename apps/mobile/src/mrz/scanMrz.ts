/**
 * Extraction MRZ par caméra + OCR on-device (ML Kit Text Recognition, Latin) — voir
 * authentik/README.md §"Capture caméra MRZ". La photo capturée par `expo-camera`
 * (authentik/components/MrzCameraScanner.tsx) est recadrée sur la zone du cadre-guide affiché à
 * l'écran, puis passée à l'OCR. Le texte reconnu est filtré aux lignes qui ressemblent à de la MRZ
 * (alphabet [A-Z0-9<], longueur exacte 44 ou 30 après suppression des espaces), puis validé par le
 * vrai parseur/chiffres de contrôle ICAO 9303 (@emrtd-verify/emrtd-core) — jamais par heuristique
 * seule : une lecture n'est acceptée que si ses chiffres de contrôle sont corrects.
 */
import * as ImageManipulator from "expo-image-manipulator";
import TextRecognition, { type TextBlock } from "@react-native-ml-kit/text-recognition";
import { parseMrzTd3, parseMrzTd1, MrzParseError, type ParsedMrz } from "@emrtd-verify/emrtd-core";

export interface MrzGuideRect {
  /** Fractions [0,1] du cadre-guide par rapport à la photo capturée (recadrage avant OCR). */
  originXRatio: number;
  originYRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface MrzScanSuccess {
  ok: true;
  parsed: ParsedMrz;
  /** Sous-champs bruts AAMMJJ/numéro, mêmes largeurs fixes que la saisie manuelle (MrzFormState). */
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
}

export interface MrzScanFailure {
  ok: false;
  reason: "no-text" | "no-valid-mrz";
}

export type MrzScanResult = MrzScanSuccess | MrzScanFailure;

const MRZ_CHARS = /^[A-Z0-9<]+$/;

function cleanCandidateLine(raw: string): string {
  // L'OCR peut renvoyer des espaces parasites entre lettres — la MRZ n'en contient jamais (les
  // espaces y sont toujours le filler `<`) donc on peut les retirer sans perte d'information.
  return raw.toUpperCase().replace(/\s+/g, "");
}

function extractLines(blocks: TextBlock[]): string[] {
  const withPos = blocks.flatMap((b) => b.lines.map((l) => ({ text: l.text, top: l.frame?.top ?? 0 })));
  withPos.sort((a, b) => a.top - b.top);
  return withPos.map((l) => cleanCandidateLine(l.text)).filter((l) => l.length > 0);
}

function tryTd3(candidates: string[]): ParsedMrz | null {
  const lines44 = candidates.filter((l) => l.length === 44 && MRZ_CHARS.test(l));
  for (let i = 0; i + 1 < lines44.length; i++) {
    try {
      const parsed = parseMrzTd3(lines44[i], lines44[i + 1]);
      if (parsed.validation.documentNumberValid && parsed.validation.dateOfBirthValid && parsed.validation.dateOfExpiryValid) {
        return parsed;
      }
    } catch (e) {
      if (!(e instanceof MrzParseError)) throw e;
    }
  }
  return null;
}

function tryTd1(candidates: string[]): ParsedMrz | null {
  const lines30 = candidates.filter((l) => l.length === 30 && MRZ_CHARS.test(l));
  for (let i = 0; i + 2 < lines30.length; i++) {
    try {
      const parsed = parseMrzTd1(lines30[i], lines30[i + 1], lines30[i + 2]);
      if (parsed.validation.documentNumberValid && parsed.validation.dateOfBirthValid && parsed.validation.dateOfExpiryValid) {
        return parsed;
      }
    } catch (e) {
      if (!(e instanceof MrzParseError)) throw e;
    }
  }
  return null;
}

/** AAMMJJ/numéro bruts depuis les lignes MRZ acceptées — mêmes offsets fixes que mrzParser.ts. */
function extractRawFields(parsed: ParsedMrz): { documentNumber: string; dateOfBirth: string; dateOfExpiry: string } {
  if (parsed.format === "TD3") {
    const [, line2] = parsed.rawLines;
    return {
      documentNumber: line2.slice(0, 9).replace(/</g, ""),
      dateOfBirth: line2.slice(13, 19),
      dateOfExpiry: line2.slice(21, 27),
    };
  }
  const [line1, line2] = parsed.rawLines;
  return {
    documentNumber: line1.slice(5, 14).replace(/</g, ""),
    dateOfBirth: line2.slice(0, 6),
    dateOfExpiry: line2.slice(8, 14),
  };
}

/**
 * Recadre la photo sur le cadre-guide affiché à l'écran, lance l'OCR, puis tente une lecture MRZ
 * TD3 (passeport, 2 lignes de 44) ou TD1 (carte, 3 lignes de 30) validée par chiffres de contrôle.
 */
export async function scanMrzFromPhoto(
  photoUri: string,
  photoWidth: number,
  photoHeight: number,
  guide: MrzGuideRect,
): Promise<MrzScanResult> {
  const crop = {
    originX: Math.round(guide.originXRatio * photoWidth),
    originY: Math.round(guide.originYRatio * photoHeight),
    width: Math.round(guide.widthRatio * photoWidth),
    height: Math.round(guide.heightRatio * photoHeight),
  };
  const targetWidth = Math.min(2000, Math.max(1200, crop.width));
  const cropped = await ImageManipulator.manipulateAsync(
    photoUri,
    [{ crop }, { resize: { width: targetWidth } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
  );

  const result = await TextRecognition.recognize(cropped.uri);
  const candidates = extractLines(result.blocks);
  if (candidates.length === 0) {
    return { ok: false, reason: "no-text" };
  }

  const parsed = tryTd3(candidates) ?? tryTd1(candidates);
  if (!parsed) {
    return { ok: false, reason: "no-valid-mrz" };
  }

  return { ok: true, parsed, ...extractRawFields(parsed) };
}
