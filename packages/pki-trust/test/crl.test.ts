import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { crlDistributionPointUrls, decodeCrl, verifyRevocationList } from "../src/crl";
import { validateTrustChain } from "../src/chainValidator";
import { NationalPkdRegistry } from "../src/nationalPkdAdapter";
import { ExtendedTrustStore } from "../src/trustStore";
import {
  buildSignedCrl,
  buildSignedSod,
  cscaToTrustAnchor,
  encodeLdsSecurityObject,
  generateCertificate,
  generateCscaAndDsc,
} from "./support/pkiFixtures";

const DG1 = new TextEncoder().encode("P<UTOERIKSSON<<ANNA<MARIA");

async function scenario() {
  const { csca, dsc } = await generateCscaAndDsc("UT");
  const hash = new Uint8Array(createHash("sha256").update(DG1).digest());
  const sodDer = await buildSignedSod({
    ldsSecurityObjectDer: encodeLdsSecurityObject({ version: 0, digestAlgorithm: "SHA-256", dataGroupHashes: [{ dataGroupNumber: 1, hash }] }),
    signer: dsc,
  });
  return { csca, dsc, sodDer, computedDataGroupHashes: [{ dataGroupNumber: 1 as const, hash }] };
}

describe("CRL de CSCA", () => {
  it("accepte une CRL signée par le CSCA et refuse une CRL au même nom signée par une autre clé", async () => {
    const { csca, dsc } = await scenario();
    const crlDer = await buildSignedCrl({ issuer: csca, revoked: [dsc.certificate] });
    const verified = await verifyRevocationList(crlDer, [csca.certificateDer]);
    expect(verified?.signerSubject).toBe(decodeCrl(crlDer).issuer);
    expect(verified?.stale).toBe(false);
    expect(verified?.revokedSerialNumbersHex).toHaveLength(1);

    // Faussaire : même nom de CSCA (généré avec le même CN/C), autre clé privée.
    const { csca: forger } = await generateCscaAndDsc("UT");
    const forged = await buildSignedCrl({ issuer: forger, revoked: [] });
    expect(await verifyRevocationList(forged, [csca.certificateDer])).toBeUndefined();
  });

  it("marque périmée une CRL dont nextUpdate est dépassée", async () => {
    const { csca } = await scenario();
    const old = await buildSignedCrl({ issuer: csca, revoked: [], thisUpdate: new Date("2025-01-01"), nextUpdate: new Date("2025-04-01") });
    expect((await verifyRevocationList(old, [csca.certificateDer]))?.stale).toBe(true);
  });

  it("validateTrustChain applique la CRL du CSCA retenu : DSC révoqué, ou vérifié non révoqué", async () => {
    const { csca, dsc, sodDer, computedDataGroupHashes } = await scenario();
    const base = {
      countryCode: "UT",
      sodDer,
      computedDataGroupHashes,
      icaoPkdAnchors: [cscaToTrustAnchor("UT", csca)],
      nationalPkdRegistry: new NationalPkdRegistry(),
      extendedTrustStore: new ExtendedTrustStore([]),
      clientAcceptedLevels: ["high" as const],
    };
    const revokedList = (await verifyRevocationList(await buildSignedCrl({ issuer: csca, revoked: [dsc.certificate] }), [csca.certificateDer]))!;
    const revoked = await validateTrustChain({ ...base, revocationLists: [revokedList] });
    expect(revoked).toMatchObject({ revocationChecked: true, revoked: true });

    const cleanList = (await verifyRevocationList(await buildSignedCrl({ issuer: csca, revoked: [] }), [csca.certificateDer]))!;
    const clean = await validateTrustChain({ ...base, revocationLists: [cleanList] });
    expect(clean).toMatchObject({ revocationChecked: true, revoked: false });
    expect(clean.revocationListUsed?.stale).toBe(false);

    // Périmée et sans le DSC : pas de preuve de non-révocation.
    const staleList = (await verifyRevocationList(
      await buildSignedCrl({ issuer: csca, revoked: [], thisUpdate: new Date("2025-01-01"), nextUpdate: new Date("2025-04-01") }),
      [csca.certificateDer],
    ))!;
    expect(await validateTrustChain({ ...base, revocationLists: [staleList] })).toMatchObject({ revocationChecked: false, revoked: false });
  });

  it("lit les adresses HTTP(S) de l'extension CRLDistributionPoints", async () => {
    const cert = await generateCertificate({
      commonName: "CSCA UT",
      countryCode: "UT",
      isCa: true,
      crlDistributionPoints: ["https://pkd.example/UTO.crl", "ldap://dir.example/cn=CSCA", "http://csca.example/crl"],
    });
    expect(crlDistributionPointUrls(cert.certificateDer)).toEqual(["https://pkd.example/UTO.crl", "http://csca.example/crl"]);
  });
});
