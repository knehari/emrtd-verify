import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { Integer, Sequence } from "asn1js";
import { sha256, toArrayBuffer } from "@emrtd-verify/emrtd-core";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";
// Fixtures de test réelles (chaîne CSCA/DSC + SOD signé) réutilisées depuis emrtd-core plutôt que
// dupliquées ici — code réservé aux tests (jamais importé par du code de production), voir
// packages/emrtd-core/test/support/pkiFixtures.ts.
import { generateCscaAndDsc, buildSignedSod } from "../../../../packages/emrtd-core/test/support/pkiFixtures";
import { encodeLdsSecurityObject } from "../../../../packages/emrtd-core/src/lds/ldsSecurityObjectAsn1";

let mockAnchors: CscaTrustAnchor[] = [];
vi.mock("../../src/pki/cscaBundleSync", () => ({
  getLocalCscaAnchors: vi.fn(async (countryCode?: string) => (countryCode ? mockAnchors.filter((a) => a.countryCode === countryCode) : mockAnchors)),
}));

const { computeLocalVerification, LocalVerificationError } = await import("../../src/verification/localVerification");

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

async function buildSignedChipData(options: { withActiveAuthentication?: boolean } = {}) {
  const { csca, dsc } = await generateCscaAndDsc("UTO");
  const dg1 = buildDg1(line1 + line2);

  const dataGroups: Record<number, Uint8Array> = { 1: dg1 };
  let activeAuthentication: { challenge: Uint8Array; responseDer: Uint8Array } | undefined;
  const dataGroupHashes = [{ dataGroupNumber: 1 as const, hash: sha256(dg1) }];

  if (options.withActiveAuthentication) {
    const aaKeyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const spkiDer = new Uint8Array(await webcrypto.subtle.exportKey("spki", aaKeyPair.publicKey));
    const dg15 = buildDg15(spkiDer);
    dataGroups[15] = dg15;
    dataGroupHashes.push({ dataGroupNumber: 15 as const, hash: sha256(dg15) });

    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const rawSignature = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, aaKeyPair.privateKey, toArrayBuffer(challenge)));
    activeAuthentication = { challenge, responseDer: rawEcdsaSignatureToDer(rawSignature, 32) };
  }

  const ldsSecurityObject = {
    version: 0,
    digestAlgorithm: "SHA-256" as const,
    dataGroupHashes,
  };
  const sod = await buildSignedSod({ ldsSecurityObjectDer: encodeLdsSecurityObject(ldsSecurityObject), signer: dsc });

  const cscaAnchor: CscaTrustAnchor = {
    countryCode: "UTO",
    certificateDer: csca.certificateDer,
    subject: "CN=CSCA UTO",
    serialNumber: "1",
    notBefore: new Date(Date.now() - 86_400_000).toISOString(),
    notAfter: new Date(Date.now() + 86_400_000 * 365).toISOString(),
    source: "icao-pkd",
    level: "high",
  };

  return { sod, dg1, dataGroups, activeAuthentication, cscaAnchor };
}

describe("computeLocalVerification", () => {
  beforeEach(() => {
    mockAnchors = [];
  });

  it("produit un verdict provisoire suspicious (au mieux) quand tout le reste est valide — LOST_STOLEN_STATUS_NOT_CHECKED est inévitable hors ligne", async () => {
    const { sod, dataGroups, activeAuthentication, cscaAnchor } = await buildSignedChipData({ withActiveAuthentication: true });
    mockAnchors = [cscaAnchor];

    const result = await computeLocalVerification({
      documentType: "ePassport",
      chipData: { sod, dataGroups, activeAuthentication },
      requestedFields: ["documentNumber"],
    });

    expect(result.provisional).toBe(true);
    // Jamais "authentic" en local : le registre perdu/volé (serveur uniquement) ne peut jamais
    // être interrogé hors ligne, donc LOST_STOLEN_STATUS_NOT_CHECKED (warning) est systématique —
    // propriété voulue, pas un bug (voir docstring de computeLocalVerification), qui renforce
    // honnêtement que ce verdict reste provisoire tant que la réconciliation backend n'a pas eu lieu.
    expect(result.verdict).toBe("suspicious");
    expect(result.anomalies).toContainEqual(expect.objectContaining({ code: "LOST_STOLEN_STATUS_NOT_CHECKED" }));
    expect(result.trustChain.sodSignatureValid).toBe(true);
    expect(result.trustChain.dscTrustedByCsca).toBe(true);
    expect(result.document.issuingCountry).toBe("UTO");
    expect(result.document.fields.documentNumber?.value).toBe("L898902C3");
    expect(result.anomalies.some((a) => a.severity === "critical")).toBe(false);
  });

  it("dégrade en manual_review_required quand aucun CSCA de confiance n'est disponible localement (bundle jamais synchronisé)", async () => {
    const { sod, dg1 } = await buildSignedChipData();
    mockAnchors = []; // aucune ancre synchronisée

    const result = await computeLocalVerification({
      documentType: "ePassport",
      chipData: { sod, dataGroups: { 1: dg1 } },
    });

    expect(result.provisional).toBe(true);
    expect(result.trustChain.noTrustAnchorAvailable).toBe(true);
    expect(result.anomalies).toContainEqual(expect.objectContaining({ code: "NO_TRUST_ANCHOR", severity: "critical" }));
    expect(result.verdict).toBe("rejected");
  });

  it("signale LOST_STOLEN_STATUS_NOT_CHECKED (jamais vérifiable hors ligne) sans jamais le traiter comme non signalé", async () => {
    const { sod, dg1, cscaAnchor } = await buildSignedChipData();
    mockAnchors = [cscaAnchor];

    const result = await computeLocalVerification({
      documentType: "ePassport",
      chipData: { sod, dataGroups: { 1: dg1 } },
    });

    expect(result.anomalies).toContainEqual(expect.objectContaining({ code: "LOST_STOLEN_STATUS_NOT_CHECKED", severity: "warning" }));
  });

  it("lève LocalVerificationError si les données de puce sont illisibles", async () => {
    await expect(
      computeLocalVerification({
        documentType: "ePassport",
        chipData: { sod: Uint8Array.from([0x01, 0x02]), dataGroups: {} },
      }),
    ).rejects.toBeInstanceOf(LocalVerificationError);
  });
});
