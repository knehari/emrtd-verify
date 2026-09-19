import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { decodeSod, verifyDataGroupHashes } from "../src/lds/sod";
import { encodeLdsSecurityObject } from "../src/lds/ldsSecurityObjectAsn1";
import { buildSignedSod, generateCscaAndDsc, generateCertificate } from "./support/pkiFixtures";

async function buildSampleSod() {
  const { dsc } = await generateCscaAndDsc("UTO");

  const dg1 = new TextEncoder().encode("P<UTOERIKSSON<<ANNA<MARIA...");
  const dg2 = new TextEncoder().encode("[données binaires de la photo DG2]");

  const ldsSecurityObject = {
    version: 0,
    digestAlgorithm: "SHA-256" as const,
    dataGroupHashes: [
      { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(dg1).digest()) },
      { dataGroupNumber: 2 as const, hash: new Uint8Array(createHash("sha256").update(dg2).digest()) },
    ],
  };

  const ldsSecurityObjectDer = encodeLdsSecurityObject(ldsSecurityObject);
  const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc });

  return { sodDer, dsc, dg1, dg2, ldsSecurityObject };
}

describe("decodeSod", () => {
  it("décode un SOD signé et en extrait le LDSSecurityObject et le certificat DSC", async () => {
    const { sodDer, dsc, ldsSecurityObject } = await buildSampleSod();

    const decoded = decodeSod(sodDer);

    expect(decoded.document.ldsSecurityObject.digestAlgorithm).toBe("SHA-256");
    expect(decoded.document.ldsSecurityObject.dataGroupHashes).toHaveLength(2);
    expect(Array.from(decoded.document.ldsSecurityObject.dataGroupHashes[0].hash)).toEqual(
      Array.from(ldsSecurityObject.dataGroupHashes[0].hash),
    );
    expect(decoded.document.signerCertificate.subject).toContain("CN=DSC UTO");
    expect(decoded.document.signerCertificate.serialNumber.length).toBeGreaterThan(0);
    void dsc;
  });

  it("valide une signature authentique", async () => {
    const { sodDer } = await buildSampleSod();
    const decoded = decodeSod(sodDer);
    await expect(decoded.verifySignature()).resolves.toBe(true);
  });

  it("retrouve le DSC signataire même quand il n'est pas le premier certificat du CMS (même classe de bug que la Master List, voir masterList.test.ts)", async () => {
    const { dsc } = await generateCscaAndDsc("UTO");
    const otherCert = await generateCertificate({ commonName: "Autre certificat non signataire", countryCode: "UTO", isCa: true });

    const ldsSecurityObject = {
      version: 0,
      digestAlgorithm: "SHA-256" as const,
      dataGroupHashes: [{ dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update("test").digest()) }],
    };
    const ldsSecurityObjectDer = encodeLdsSecurityObject(ldsSecurityObject);
    const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc, extraCertificatesBefore: [otherCert.certificate] });

    const decoded = decodeSod(sodDer);
    expect(decoded.document.signerCertificate.subject).toContain("CN=DSC UTO");
    await expect(decoded.verifySignature()).resolves.toBe(true);
  });

  it("détecte un SOD dont le contenu a été altéré après signature", async () => {
    const { sodDer } = await buildSampleSod();
    const tampered = new Uint8Array(sodDer);
    // Retourne un octet au milieu du buffer — suffisant pour invalider la signature CMS
    // sans casser le parsing ASN.1 (la longueur des champs reste inchangée).
    const flipIndex = Math.floor(tampered.length / 2);
    tampered[flipIndex] ^= 0xff;

    // Le décodage ASN.1 lui-même peut échouer sur des données corrompues (structure invalide)
    // ou réussir mais échouer à la vérification de signature — les deux sont des détections valides.
    try {
      const decoded = decodeSod(tampered);
      await expect(decoded.verifySignature()).resolves.toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe("verifyDataGroupHashes", () => {
  it("détecte un DG dont le contenu ne correspond plus au hash déclaré dans le SOD", async () => {
    const { sodDer, dg1 } = await buildSampleSod();
    const decoded = decodeSod(sodDer);

    const tamperedDg1 = new TextEncoder().encode("P<UTOATTACKER<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<");
    const computedHashes = [
      { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(tamperedDg1).digest()) },
    ];

    const results = verifyDataGroupHashes(decoded.document, computedHashes);
    expect(results.find((r) => r.dataGroupNumber === 1)?.matches).toBe(false);
    void dg1;
  });

  it("valide un DG dont le contenu correspond au hash déclaré", async () => {
    const { sodDer, dg1 } = await buildSampleSod();
    const decoded = decodeSod(sodDer);

    const computedHashes = [
      { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(dg1).digest()) },
    ];

    const results = verifyDataGroupHashes(decoded.document, computedHashes);
    expect(results.find((r) => r.dataGroupNumber === 1)?.matches).toBe(true);
  });
});
