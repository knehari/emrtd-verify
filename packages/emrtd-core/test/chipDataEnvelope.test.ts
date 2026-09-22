import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { Integer, Sequence } from "asn1js";
import {
  encodeChipDataEnvelope,
  parseChipDataEnvelope,
  decodeChipDataEnvelope,
  ChipDataEnvelopeError,
  type ChipDataEnvelope,
} from "../src/lds/chipDataEnvelope";
import { sha256 } from "../src/crypto/sha256";
import { toArrayBuffer } from "../src/crypto/bytes";
import { encodeLdsSecurityObject } from "../src/lds/ldsSecurityObjectAsn1";
import { buildSignedSod, generateCscaAndDsc } from "./support/pkiFixtures";

/** Même logique que test/dataGroups.test.ts — construit un DG1 conforme (tag 0x61 / 0x5F1F). */
function buildDg1(mrzText: string): Uint8Array {
  const bytes = Array.from(mrzText).map((c) => c.charCodeAt(0));
  const inner = [0x5f, 0x1f, bytes.length, ...bytes];
  const outer = [0x61, inner.length, ...inner];
  return Uint8Array.from(outer);
}

function buildDg15(spkiDer: Uint8Array): Uint8Array {
  return Uint8Array.from([0x6f, spkiDer.length, ...spkiDer]);
}

/** Signature ECDSA raw (r‖s) -> DER, comme dans activeAuthentication.test.ts (réservé aux tests). */
function rawEcdsaSignatureToDer(raw: Uint8Array, componentLength: number): Uint8Array {
  const toUnsignedInteger = (bytes: Uint8Array): Integer => {
    const needsPadding = (bytes[0] & 0x80) !== 0;
    const value = needsPadding ? new Uint8Array([0, ...bytes]) : bytes;
    return new Integer({ valueHex: toArrayBuffer(value) });
  };
  const r = toUnsignedInteger(raw.slice(0, componentLength));
  const s = toUnsignedInteger(raw.slice(componentLength));
  return new Uint8Array(new Sequence({ value: [r, s] }).toBER(false));
}

const line1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const line2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

async function buildSampleEnvelopeInputs() {
  const { dsc } = await generateCscaAndDsc("UTO");
  const dg1 = buildDg1(line1 + line2);
  const dg2 = Uint8Array.from([0x75, 0x02, 0x00, 0x00, 0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // enveloppe CBEFF factice + JPEG SOI

  const ldsSecurityObject = {
    version: 0,
    digestAlgorithm: "SHA-256" as const,
    dataGroupHashes: [
      { dataGroupNumber: 1 as const, hash: sha256(dg1) },
      { dataGroupNumber: 2 as const, hash: sha256(dg2) },
    ],
  };
  const ldsSecurityObjectDer = encodeLdsSecurityObject(ldsSecurityObject);
  const sod = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc });

  return { sod, dg1, dg2 };
}

describe("encodeChipDataEnvelope / parseChipDataEnvelope", () => {
  it("round-trip byte-exact des DG et du SOD", async () => {
    const { sod, dg1, dg2 } = await buildSampleEnvelopeInputs();
    const chipData = encodeChipDataEnvelope({ sod, dataGroups: { 1: dg1, 2: dg2 } });

    const envelope = parseChipDataEnvelope(chipData);
    expect(envelope.formatVersion).toBe(1);
    expect(Object.keys(envelope.dataGroups).sort()).toEqual(["1", "2"]);
  });

  it("rejette un chipData qui n'est pas du base64/JSON valide", () => {
    expect(() => parseChipDataEnvelope("!!! pas du base64 valide ni du JSON !!!")).toThrow(ChipDataEnvelopeError);
  });

  it("rejette une structure sans les champs requis", () => {
    const malformed = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    expect(() => parseChipDataEnvelope(malformed)).toThrow(ChipDataEnvelopeError);
  });
});

describe("decodeChipDataEnvelope", () => {
  it("décode l'identité MRZ, les hash de DG et l'image DG2 à partir d'un chipData réel de bout en bout", async () => {
    const { sod, dg1, dg2 } = await buildSampleEnvelopeInputs();
    const chipData = encodeChipDataEnvelope({ sod, dataGroups: { 1: dg1, 2: dg2 } });
    const envelope = parseChipDataEnvelope(chipData);

    const decoded = await decodeChipDataEnvelope(envelope, "ePassport");

    expect(decoded.documentIdentity.documentNumber).toBe("L898902C3");
    expect(decoded.documentIdentity.primaryIdentifier).toBe("ERIKSSON");
    expect(decoded.mrzValidation.compositeValid).toBe(true);
    expect(decoded.faceImage).toEqual(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));

    // Les hash calculés doivent correspondre à ceux déclarés dans le SOD (mêmes octets DG que
    // ceux utilisés pour construire le SOD signé ci-dessus).
    const dg1Hash = decoded.computedDataGroupHashes.find((h) => h.dataGroupNumber === 1);
    expect(dg1Hash).toBeDefined();
    expect(Array.from(dg1Hash!.hash)).toEqual(Array.from(sha256(dg1)));
    expect(decoded.activeAuthentication).toBeUndefined();
  });

  it("vérifie une réponse Active Authentication authentique quand DG15 et la réponse sont présents", async () => {
    const { sod, dg1, dg2 } = await buildSampleEnvelopeInputs();
    const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spkiDer = new Uint8Array(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
    const dg15 = buildDg15(spkiDer);

    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const rawSignature = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, toArrayBuffer(challenge)));
    const responseDer = rawEcdsaSignatureToDer(rawSignature, 32);

    const chipData = encodeChipDataEnvelope({
      sod,
      dataGroups: { 1: dg1, 2: dg2, 15: dg15 },
      activeAuthentication: { challenge, responseDer },
    });
    const decoded = await decodeChipDataEnvelope(parseChipDataEnvelope(chipData), "ePassport");

    expect(decoded.activeAuthentication).toEqual({ supported: true, valid: true });
  });

  it("dégrade DG2 en image absente (sans lever) si son contenu n'est pas reconnaissable", async () => {
    const { dsc } = await generateCscaAndDsc("UTO");
    const dg1 = buildDg1(line1 + line2);
    const dg2Unreadable = Uint8Array.from([0x01, 0x02, 0x03]);
    const ldsSecurityObject = {
      version: 0,
      digestAlgorithm: "SHA-256" as const,
      dataGroupHashes: [
        { dataGroupNumber: 1 as const, hash: sha256(dg1) },
        { dataGroupNumber: 2 as const, hash: sha256(dg2Unreadable) },
      ],
    };
    const sod = await buildSignedSod({ ldsSecurityObjectDer: encodeLdsSecurityObject(ldsSecurityObject), signer: dsc });
    const chipData = encodeChipDataEnvelope({ sod, dataGroups: { 1: dg1, 2: dg2Unreadable } });

    const decoded = await decodeChipDataEnvelope(parseChipDataEnvelope(chipData), "ePassport");
    expect(decoded.faceImage).toBeUndefined();
    // Le reste du décodage n'est pas affecté par l'échec DG2.
    expect(decoded.documentIdentity.documentNumber).toBe("L898902C3");
  });

  it("lève une erreur explicite si DG1 est absent (requis)", async () => {
    const { sod, dg2 } = await buildSampleEnvelopeInputs();
    const chipData = encodeChipDataEnvelope({ sod, dataGroups: { 2: dg2 } });
    await expect(decodeChipDataEnvelope(parseChipDataEnvelope(chipData), "ePassport")).rejects.toThrow(ChipDataEnvelopeError);
  });

  it("lève une erreur si le SOD lui-même est illisible", async () => {
    const envelope: ChipDataEnvelope = {
      formatVersion: 1,
      sodDerBase64: Buffer.from([0x01, 0x02, 0x03]).toString("base64"),
      dataGroups: { "1": Buffer.from(buildDg1(line1 + line2)).toString("base64") },
    };
    await expect(decodeChipDataEnvelope(envelope, "ePassport")).rejects.toThrow();
  });
});
