import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { certificateSerialNumberHex } from "@emrtd-verify/emrtd-core";
import { validateTrustChain } from "../src/chainValidator";
import { NationalPkdRegistry } from "../src/nationalPkdAdapter";
import { ExtendedTrustStore } from "../src/trustStore";
import {
  buildSignedSod,
  cscaToTrustAnchor,
  encodeLdsSecurityObject,
  generateCertificate,
  generateCscaAndDsc,
} from "./support/pkiFixtures";

const DG1_CONTENT = new TextEncoder().encode("P<UTOERIKSSON<<ANNA<MARIA...");

async function buildScenario(countryCode = "UTO") {
  const { csca, dsc } = await generateCscaAndDsc(countryCode);
  const ldsSecurityObjectDer = encodeLdsSecurityObject({
    version: 0,
    digestAlgorithm: "SHA-256",
    dataGroupHashes: [{ dataGroupNumber: 1, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) }],
  });
  const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc });
  const computedDataGroupHashes = [
    { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) },
  ];
  return { csca, dsc, sodDer, computedDataGroupHashes, countryCode };
}

describe("validateTrustChain", () => {
  it("valide une chaîne CSCA -> DSC -> SOD authentique et cohérente", async () => {
    const { csca, sodDer, computedDataGroupHashes, countryCode } = await buildScenario();

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor(countryCode, csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.sodSignatureValid).toBe(true);
    expect(result.dscTrustedByCsca).toBe(true);
    expect(result.dscWithinValidityPeriod).toBe(true);
    expect(result.dataGroupHashMismatches).toHaveLength(0);
    expect(result.noTrustAnchorAvailable).toBe(false);
    expect(result.level).toBe("high");
    expect(result.sufficientForClientPolicy).toBe(true);
  });

  it("CNI française : code MRZ FRA contre CSCA C=FR, plusieurs CSCA valides — retient celui qui a signé le DSC", async () => {
    const { csca, sodDer, computedDataGroupHashes } = await buildScenario("FR");
    const { csca: otherFrenchCsca } = await generateCscaAndDsc("FR");

    const result = await validateTrustChain({
      countryCode: "FRA",
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor("FR", otherFrenchCsca), cscaToTrustAnchor("FR", csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.noTrustAnchorAvailable).toBe(false);
    expect(result.dscTrustedByCsca).toBe(true);
    expect(result.sufficientForClientPolicy).toBe(true);
    expect(result.csca?.serialNumber).toBe(certificateSerialNumberHex(csca.certificate));
    expect(result.dsc?.issuer).toBe(result.csca?.subject);
    expect(result.dataGroupsVerified).toEqual([1]);
  });

  it("un DG déclaré dans le SOD mais non lu (ex. DG3 protégé par EAC) n'est pas une incohérence de hash", async () => {
    const { csca, dsc } = await generateCscaAndDsc("UTO");
    const dg1Hash = new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest());
    const ldsSecurityObjectDer = encodeLdsSecurityObject({
      version: 0,
      digestAlgorithm: "SHA-256",
      dataGroupHashes: [
        { dataGroupNumber: 1, hash: dg1Hash },
        { dataGroupNumber: 3, hash: new Uint8Array(32).fill(3) },
        { dataGroupNumber: 11, hash: new Uint8Array(32).fill(11) },
      ],
    });
    const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: dsc });

    const result = await validateTrustChain({
      countryCode: "UTO",
      sodDer,
      computedDataGroupHashes: [{ dataGroupNumber: 1, hash: dg1Hash }],
      icaoPkdAnchors: [cscaToTrustAnchor("UTO", csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.dataGroupHashMismatches).toEqual([]);
    expect(result.dataGroupsVerified).toEqual([1]);
    expect(result.dataGroupsNotRead).toEqual([3, 11]);
  });

  it("un DG lu mais absent du SOD est une incohérence (rien ne l'authentifie)", async () => {
    const { csca, sodDer, computedDataGroupHashes } = await buildScenario();
    const result = await validateTrustChain({
      countryCode: "UTO",
      sodDer,
      computedDataGroupHashes: [...computedDataGroupHashes, { dataGroupNumber: 2, hash: new Uint8Array(32) }],
      icaoPkdAnchors: [cscaToTrustAnchor("UTO", csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });
    expect(result.dataGroupHashMismatches).toEqual([2]);
  });

  it("détecte un DSC signé par un CSCA différent de celui déclaré de confiance (usurpation)", async () => {
    const { sodDer, computedDataGroupHashes, countryCode } = await buildScenario();
    // Un CSCA "de confiance" différent, sans lien de signature avec le DSC réel utilisé.
    const { csca: unrelatedCsca } = await generateCscaAndDsc(countryCode);

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor(countryCode, unrelatedCsca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.sodSignatureValid).toBe(true); // le SOD lui-même n'est pas altéré...
    expect(result.dscTrustedByCsca).toBe(false); // ...mais son DSC ne remonte pas à ce CSCA
    expect(result.sufficientForClientPolicy).toBe(false); // jamais suffisant sans chaîne DSC<-CSCA valide
  });

  it("rejette un SOD dont la signature ne correspond pas au DSC déclaré, même avec un CSCA de confiance valide", async () => {
    const { csca, dsc, countryCode } = await buildScenario();
    // Un second DSC, sans aucun lien avec le premier, dont on emprunte la clé privée pour
    // signer le SOD — le SOD prétend toujours être signé par `dsc` (certificat embarqué), mais
    // la signature ne vérifie pas avec sa clé publique réelle.
    const { dsc: unrelatedDsc } = await generateCscaAndDsc(`${countryCode}2`);
    const ldsSecurityObjectDer = encodeLdsSecurityObject({
      version: 0,
      digestAlgorithm: "SHA-256",
      dataGroupHashes: [{ dataGroupNumber: 1, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) }],
    });
    const sodDer = await buildSignedSod({
      ldsSecurityObjectDer,
      signer: { certificateDer: dsc.certificateDer, certificate: dsc.certificate, privateKey: unrelatedDsc.privateKey },
    });
    const computedDataGroupHashes = [
      { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) },
    ];

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor(countryCode, csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.sodSignatureValid).toBe(false);
    expect(result.dscTrustedByCsca).toBe(true); // le certificat embarqué remonte bien au CSCA...
    expect(result.sufficientForClientPolicy).toBe(false); // ...mais la signature elle-même est invalide
  });

  it("rejette un DSC hors de sa période de validité, même signé par un CSCA de confiance", async () => {
    const { csca } = await buildScenario();
    const expiredDsc = await generateCertificate({
      commonName: "DSC expiré",
      countryCode: "UTO",
      isCa: false,
      issuer: { certificate: csca.certificate, privateKey: csca.privateKey },
      notBefore: new Date(Date.now() - 730 * 24 * 3600 * 1000),
      notAfter: new Date(Date.now() - 365 * 24 * 3600 * 1000),
    });
    const ldsSecurityObjectDer = encodeLdsSecurityObject({
      version: 0,
      digestAlgorithm: "SHA-256",
      dataGroupHashes: [{ dataGroupNumber: 1, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) }],
    });
    const sodDer = await buildSignedSod({ ldsSecurityObjectDer, signer: expiredDsc });
    const computedDataGroupHashes = [
      { dataGroupNumber: 1 as const, hash: new Uint8Array(createHash("sha256").update(DG1_CONTENT).digest()) },
    ];

    const result = await validateTrustChain({
      countryCode: "UTO",
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor("UTO", csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.sodSignatureValid).toBe(true);
    expect(result.dscTrustedByCsca).toBe(true);
    expect(result.dscWithinValidityPeriod).toBe(false);
    expect(result.sufficientForClientPolicy).toBe(false);
  });

  it("signale l'absence de toute ancre de confiance pour le pays", async () => {
    const { sodDer, computedDataGroupHashes, countryCode } = await buildScenario();

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
    });

    expect(result.noTrustAnchorAvailable).toBe(true);
    expect(result.sufficientForClientPolicy).toBe(false);
  });

  it("détecte une révocation via la CRL fournie", async () => {
    const { csca, dsc, sodDer, computedDataGroupHashes, countryCode } = await buildScenario();

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor(countryCode, csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high", "medium"],
      revocationList: {
        issuer: `CN=CSCA ${countryCode}`,
        thisUpdate: new Date().toISOString(),
        revokedSerialNumbersHex: [certificateSerialNumberHex(dsc.certificate)],
      },
    });

    expect(result.revocationChecked).toBe(true);
    expect(result.revoked).toBe(true);
  });

  it("rejette un pays hors politique de risque du client (magasin étendu à confiance basse)", async () => {
    const { csca, sodDer, computedDataGroupHashes, countryCode } = await buildScenario();

    const result = await validateTrustChain({
      countryCode,
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([
        {
          ...cscaToTrustAnchor(countryCode, csca, { source: "extended-trust-store", level: "low" }),
          extended: {
            provenance: "document-sample-review",
            addedBy: "test",
            addedAt: new Date().toISOString(),
            evidenceReference: "test-fixture",
            reviewBeforeDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
          },
        },
      ]),
      clientAcceptedLevels: ["high"], // le client n'accepte pas le niveau "low"
    });

    expect(result.level).toBe("low");
    expect(result.sufficientForClientPolicy).toBe(false);
  });
});
