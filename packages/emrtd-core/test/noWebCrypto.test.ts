import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { decodeSod, unwrapEfSod } from "../src/lds/sod";
import { isCertificateSignedBy } from "../src/crypto/x509";
import { encodeLdsSecurityObject } from "../src/lds/ldsSecurityObjectAsn1";
import { buildSignedSod, generateCscaAndDsc } from "./support/pkiFixtures";

/**
 * React Native/Hermes n'a pas `crypto.subtle` : la Passive Authentication doit fonctionner sans
 * (régression constatée sur iPhone avec une vraie CNI : "Web Crypto API indisponible").
 */
describe("vérification SOD / X.509 sans Web Crypto (comme sur React Native)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("décode et vérifie la signature d'un EF.SOD (0x77) et la chaîne DSC → CSCA sans crypto.subtle", async () => {
    const { csca, dsc } = await generateCscaAndDsc("FRA");
    const dg1 = new TextEncoder().encode("IDFRA…");
    const ldsSecurityObjectDer = encodeLdsSecurityObject({
      version: 0,
      digestAlgorithm: "SHA-256",
      dataGroupHashes: [{ dataGroupNumber: 1, hash: new Uint8Array(createHash("sha256").update(dg1).digest()) }],
    });
    const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc });
    const efSod = Uint8Array.from([0x77, 0x82, sodDer.length >> 8, sodDer.length & 0xff, ...sodDer]);

    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    expect(globalThis.crypto.subtle).toBeUndefined();

    const decoded = decodeSod(efSod);
    await expect(decoded.verifySignature()).resolves.toBe(true);
    await expect(isCertificateSignedBy(dsc.certificateDer, csca.certificateDer)).resolves.toBe(true);
    await expect(isCertificateSignedBy(csca.certificateDer, dsc.certificateDer)).resolves.toBe(false);
    expect(unwrapEfSod(efSod)).toHaveLength(sodDer.length);
  });
});
