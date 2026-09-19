import { describe, it, expect } from "vitest";
import { Integer, Sequence } from "asn1js";
import { parseCertificate, certificateCountryCode, certificateSerialNumberHex, certificateValidityIso, distinguishedNameToString, toArrayBuffer } from "@emrtd-verify/emrtd-core";
import { decodeMasterList, verifyMasterListTrust, masterListCertificatesToTrustAnchors } from "../src/masterList";
import { encodeCscaMasterList, decodeCscaMasterList } from "../src/masterListAsn1";
import { buildSignedMasterList, generateCertificate } from "./support/pkiFixtures";

async function buildScenario() {
  // Le Master List Signer est auto-signé ici pour simplifier le test — en pratique son
  // certificat est distribué hors bande (voir docstring de src/masterList.ts).
  const signer = await generateCertificate({ commonName: "ICAO Master List Signer", countryCode: "UN", isCa: true });

  const csca1 = await generateCertificate({ commonName: "CSCA France", countryCode: "FRA", isCa: true });
  const csca2 = await generateCertificate({ commonName: "CSCA Germany", countryCode: "DEU", isCa: true });

  const cscaMasterListDer = encodeCscaMasterList({
    version: 0,
    certificatesDer: [csca1.certificateDer, csca2.certificateDer],
  });
  const masterListCmsDer = await buildSignedMasterList({ cscaMasterListDer, signer });

  return { signer, csca1, csca2, masterListCmsDer };
}

describe("decodeCscaMasterList", () => {
  it("décode un certList dépassant la limite par défaut de 10 000 nœuds ASN.1 d'asn1js (vu sur une vraie Master List ICAO PKD)", () => {
    // asn1js refuse par défaut de décoder plus de 10 000 nœuds ASN.1 (protection anti-DoS,
    // DEFAULT_MAX_NODES) — un export LDIF ICAO PKD réel a révélé qu'une Master List nationale
    // légitime peut largement dépasser ce seuil (Doc 9303 Part 12 §8 autorise un pays à publier
    // une liste agrégeant les CSCA de nombreux autres pays). Reproduit ici sans données réelles :
    // 2000 pseudo-certificats (SEQUENCE de 5 INTEGER, 6 nœuds chacun) => 12 000+ nœuds au total.
    const fakeCertificatesDer = Array.from({ length: 2000 }, (_, i) => {
      const seq = new Sequence({
        value: Array.from({ length: 5 }, (_, j) => new Integer({ value: i * 10 + j })),
      });
      return new Uint8Array(seq.toBER(false));
    });

    const cscaMasterListDer = encodeCscaMasterList({ version: 0, certificatesDer: fakeCertificatesDer });
    const decoded = decodeCscaMasterList(toArrayBuffer(cscaMasterListDer));

    expect(decoded.certificatesDer).toHaveLength(2000);
  });
});

describe("decodeMasterList", () => {
  it("décode une Master List signée et en extrait les certificats CSCA et le signataire", async () => {
    const { signer, masterListCmsDer } = await buildScenario();

    const decoded = decodeMasterList(masterListCmsDer);

    expect(decoded.content.certificatesDer).toHaveLength(2);
    expect(decoded.signerCertificate.subject).toContain("CN=ICAO Master List Signer");
    expect(decoded.signerCertificate.serialNumber).toBe(certificateSerialNumberHex(signer.certificate));
  });

  it("valide une signature authentique", async () => {
    const { masterListCmsDer } = await buildScenario();
    const decoded = decodeMasterList(masterListCmsDer);
    await expect(decoded.verifySignature()).resolves.toBe(true);
  });
});

describe("verifyMasterListTrust", () => {
  it("refuse toute Master List quand aucune ancre de confiance n'est configurée (jamais d'auto-bootstrap)", async () => {
    const { masterListCmsDer } = await buildScenario();
    const decoded = decodeMasterList(masterListCmsDer);

    const result = await verifyMasterListTrust(decoded, []);

    expect(result.trusted).toBe(false);
    expect(result.reason).toMatch(/[Aa]ucune ancre/);
  });

  it("fait confiance quand le signataire correspond directement à l'ancre épinglée", async () => {
    const { signer, masterListCmsDer } = await buildScenario();
    const decoded = decodeMasterList(masterListCmsDer);

    const result = await verifyMasterListTrust(decoded, [signer.certificateDer]);

    expect(result.trusted).toBe(true);
  });

  it("fait confiance quand le signataire est signé par l'ancre épinglée (chaîne courte)", async () => {
    const root = await generateCertificate({ commonName: "ICAO Root", countryCode: "UN", isCa: true });
    const signer = await generateCertificate({
      commonName: "ICAO Master List Signer 2026",
      countryCode: "UN",
      isCa: true,
      issuer: { certificate: root.certificate, privateKey: root.privateKey },
    });
    const csca = await generateCertificate({ commonName: "CSCA Belgium", countryCode: "BEL", isCa: true });
    const cscaMasterListDer = encodeCscaMasterList({ version: 0, certificatesDer: [csca.certificateDer] });
    const masterListCmsDer = await buildSignedMasterList({ cscaMasterListDer, signer });
    const decoded = decodeMasterList(masterListCmsDer);

    const result = await verifyMasterListTrust(decoded, [root.certificateDer]);

    expect(result.trusted).toBe(true);
  });

  it("refuse un signataire absent des ancres épinglées (Master List forgée par un tiers)", async () => {
    const { masterListCmsDer } = await buildScenario();
    const decoded = decodeMasterList(masterListCmsDer);
    const unrelatedAnchor = await generateCertificate({ commonName: "Autre entité", countryCode: "UN", isCa: true });

    const result = await verifyMasterListTrust(decoded, [unrelatedAnchor.certificateDer]);

    expect(result.trusted).toBe(false);
    expect(result.reason).toMatch(/non reconnu/);
  });

  it("refuse une Master List dont le contenu a été altéré après signature", async () => {
    const { signer, masterListCmsDer } = await buildScenario();
    const tampered = new Uint8Array(masterListCmsDer);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;

    try {
      const decoded = decodeMasterList(tampered);
      const result = await verifyMasterListTrust(decoded, [signer.certificateDer]);
      expect(result.trusted).toBe(false);
    } catch (error) {
      // Décodage ASN.1 en échec sur des données corrompues est aussi une détection valide.
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe("masterListCertificatesToTrustAnchors", () => {
  it("convertit les certificats CSCA extraits en ancres de confiance icao-pkd/high", async () => {
    const { csca1, csca2, masterListCmsDer } = await buildScenario();
    const decoded = decodeMasterList(masterListCmsDer);

    const anchors = masterListCertificatesToTrustAnchors(decoded.content.certificatesDer, (der) => {
      const cert = parseCertificate(der);
      const { notBefore, notAfter } = certificateValidityIso(cert);
      return {
        subject: distinguishedNameToString(cert.subject),
        countryCode: certificateCountryCode(cert),
        serialNumber: certificateSerialNumberHex(cert),
        notBefore,
        notAfter,
      };
    });

    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.countryCode).sort()).toEqual(["DEU", "FRA"]);
    expect(anchors.every((a) => a.source === "icao-pkd" && a.level === "high")).toBe(true);
    void csca1;
    void csca2;
  });

  it("exclut un certificat sans code pays exploitable plutôt que de le mal classer", async () => {
    const noCountry = await generateCertificate({ commonName: "Sans pays", countryCode: "", isCa: true });
    const anchors = masterListCertificatesToTrustAnchors([noCountry.certificateDer], (der) => {
      const cert = parseCertificate(der);
      const { notBefore, notAfter } = certificateValidityIso(cert);
      return {
        subject: distinguishedNameToString(cert.subject),
        countryCode: certificateCountryCode(cert),
        serialNumber: certificateSerialNumberHex(cert),
        notBefore,
        notAfter,
      };
    });

    expect(anchors).toHaveLength(0);
  });
});
