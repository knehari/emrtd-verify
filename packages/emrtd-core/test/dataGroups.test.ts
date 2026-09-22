import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { extractDg1MrzText, splitMrzTextIntoLines, extractDg2FaceImage, extractDg15PublicKey, DataGroupParseError } from "../src/lds/dataGroups";
import { parseMrzTd3 } from "../src/mrz/mrzParser";

/** Encode une valeur en longueur BER-TLV forme définie (courte ou longue) — pour construire des fixtures de test. */
function encodeBerLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function asciiToBytes(text: string): number[] {
  return Array.from(text).map((c) => c.charCodeAt(0));
}

/** Construit un DG1 conforme (0x61 { 0x5F1F <mrz> }) à partir du texte MRZ concaténé. */
function buildDg1(mrzText: string): Uint8Array {
  const mrzBytes = asciiToBytes(mrzText);
  const inner = [0x5f, 0x1f, ...encodeBerLength(mrzBytes.length), ...mrzBytes];
  const outer = [0x61, ...encodeBerLength(inner.length), ...inner];
  return Uint8Array.from(outer);
}

describe("extractDg1MrzText / splitMrzTextIntoLines", () => {
  // Exemple de référence ICAO Doc 9303 Part 4 Appendix B, déjà utilisé/vérifié dans mrzParser.test.ts.
  const line1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
  const line2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  const concatenated = line1 + line2;

  it("extrait le texte MRZ concaténé depuis un DG1 conforme", () => {
    const dg1 = buildDg1(concatenated);
    expect(extractDg1MrzText(dg1)).toBe(concatenated);
  });

  it("découpe en 2 lignes de 44 caractères pour un texte de 88 caractères (TD3)", () => {
    expect(splitMrzTextIntoLines(concatenated)).toEqual([line1, line2]);
  });

  it("découpe en 3 lignes de 30 caractères pour un texte de 90 caractères (TD1)", () => {
    const td1Text = "A".repeat(30) + "B".repeat(30) + "C".repeat(30);
    expect(splitMrzTextIntoLines(td1Text)).toEqual(["A".repeat(30), "B".repeat(30), "C".repeat(30)]);
  });

  it("rejette une longueur de texte MRZ inattendue", () => {
    expect(() => splitMrzTextIntoLines("trop court")).toThrow(DataGroupParseError);
  });

  it("round-trip complet : DG1 réel -> texte -> lignes -> parseMrzTd3 donne le même résultat que le vecteur ICAO direct", () => {
    const dg1 = buildDg1(concatenated);
    const [extractedLine1, extractedLine2] = splitMrzTextIntoLines(extractDg1MrzText(dg1));
    const fromDg1 = parseMrzTd3(extractedLine1, extractedLine2);
    const direct = parseMrzTd3(line1, line2);
    expect(fromDg1).toEqual(direct);
    expect(fromDg1.identity.documentNumber).toBe("L898902C3");
  });

  it("rejette un tag DG1 incorrect", () => {
    const dg1 = buildDg1(concatenated);
    dg1[0] = 0x62; // tag falsifié
    expect(() => extractDg1MrzText(dg1)).toThrow(DataGroupParseError);
  });

  it("gère la forme longue de longueur BER (>127 octets)", () => {
    const longMrz = "A".repeat(200);
    const dg1 = buildDg1(longMrz);
    expect(extractDg1MrzText(dg1)).toBe(longMrz);
  });
});

describe("extractDg2FaceImage", () => {
  it("extrait une image JPEG à partir de son marqueur SOI, en ignorant l'enveloppe CBEFF avant", () => {
    const cbeffHeader = Uint8Array.from([0x75, 0x82, 0x01, 0x00, 0x7f, 0x61, 0x82, 0x00, 0xfa]); // enveloppe factice
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]); // SOI + APP0 JFIF
    const dg2 = new Uint8Array([...cbeffHeader, ...jpeg]);

    const result = extractDg2FaceImage(dg2);
    expect(result.imageFormat).toBe("JPEG");
    expect(result.imageBytes).toEqual(jpeg);
  });

  it("extrait une image JPEG2000 à partir de sa signature de boîte JP2", () => {
    const cbeffHeader = Uint8Array.from([0x75, 0x82, 0x00, 0x20]);
    const jp2BoxHeader = Uint8Array.from([0x00, 0x00, 0x00, 0x0c]); // taille de boîte (4 octets)
    const jp2Signature = Uint8Array.from([0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
    const dg2 = new Uint8Array([...cbeffHeader, ...jp2BoxHeader, ...jp2Signature]);

    const result = extractDg2FaceImage(dg2);
    expect(result.imageFormat).toBe("JPEG2000");
    expect(result.imageBytes).toEqual(new Uint8Array([...jp2BoxHeader, ...jp2Signature]));
  });

  it("lève une erreur explicite si aucune image n'est reconnaissable", () => {
    expect(() => extractDg2FaceImage(Uint8Array.from([0x01, 0x02, 0x03]))).toThrow(DataGroupParseError);
  });
});

describe("extractDg15PublicKey", () => {
  it("extrait le SubjectPublicKeyInfo DER encapsulé dans DG15 (tag 0x6F)", async () => {
    const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spkiDer = new Uint8Array(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
    const dg15 = Uint8Array.from([0x6f, spkiDer.length, ...spkiDer]);

    expect(extractDg15PublicKey(dg15)).toEqual(spkiDer);
  });

  it("rejette un tag DG15 incorrect", () => {
    expect(() => extractDg15PublicKey(Uint8Array.from([0x70, 0x00]))).toThrow(DataGroupParseError);
  });
});
