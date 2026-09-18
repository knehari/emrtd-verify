import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { certificateSerialNumberHex } from "@emrtd-verify/emrtd-core";
import { validateTrustChain } from "../src/chainValidator";
import { NationalPkdRegistry } from "../src/nationalPkdAdapter";
import { ExtendedTrustStore } from "../src/trustStore";
import { buildSignedSod, cscaToTrustAnchor, encodeLdsSecurityObject, generateCscaAndDsc } from "./support/pkiFixtures";

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
