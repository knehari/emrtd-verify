import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { BitString, Integer, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import { PublicKeyInfo, type Certificate } from "pkijs";
import { describeCertificateKey, describeSignatureAlgorithm } from "../src/crypto/x509";
import { bigIntToBytes, standardizedEcDomain } from "../src/crypto/ecCurves";
import { generateCertificate } from "./support/pkiFixtures";

const spkiOf = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) => new Uint8Array(key.export({ type: "spki", format: "der" }));
const certWithSpki = (spkiDer: Uint8Array) => ({ subjectPublicKeyInfo: PublicKeyInfo.fromBER(spkiDer) }) as unknown as Certificate;

describe("describeCertificateKey / describeSignatureAlgorithm", () => {
  it("décrit un certificat RSA signé en SHA-256", async () => {
    const { certificate } = await generateCertificate({ commonName: "CSCA Test", countryCode: "FR", isCa: true });
    expect(describeCertificateKey(certificate)).toBe("RSA 2048 bits");
    expect(describeSignatureAlgorithm(certificate)).toBe("RSA SHA-256");
  });

  it("donne la taille exacte d'un module RSA non multiple de 8", () => {
    // OpenSSL ne garantit pas la taille demandée pour un nombre impair de bits : on compare à la sienne.
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3071 });
    const bits = publicKey.asymmetricKeyDetails!.modulusLength!;
    expect(bits % 8).not.toBe(0);
    expect(describeCertificateKey(certWithSpki(spkiOf(publicKey)))).toBe(`RSA ${bits} bits`);
  });

  it("nomme une courbe désignée par son OID", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP384r1" });
    expect(describeCertificateKey(certWithSpki(spkiOf(publicKey)))).toBe("ECDSA brainpoolP384r1");
    const nist = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(describeCertificateKey(certWithSpki(spkiOf(nist.publicKey)))).toBe("ECDSA NIST P-256");
  });

  it("reconnaît une courbe standard écrite en paramètres explicites, comme chez la plupart des CSCA", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP256r1" });
    const domain = standardizedEcDomain(13)!;
    const c = domain.Point.CURVE();
    const L = domain.fieldLength;
    const namedSpki = spkiOf(publicKey);
    const point = namedSpki.subarray(namedSpki.length - (1 + 2 * L));
    const ecParameters = new Sequence({
      value: [
        new Integer({ value: 1 }),
        new Sequence({ value: [new ObjectIdentifier({ value: "1.2.840.10045.1.1" }), Integer.fromBigInt(c.p)] }),
        new Sequence({ value: [new OctetString({ valueHex: bigIntToBytes(c.a, L).buffer }), new OctetString({ valueHex: bigIntToBytes(c.b, L).buffer })] }),
        new OctetString({ valueHex: new Uint8Array([4, ...bigIntToBytes(c.Gx, L), ...bigIntToBytes(c.Gy, L)]).buffer }),
        Integer.fromBigInt(c.n),
        new Integer({ value: 1 }),
      ],
    });
    const spki = new Sequence({
      value: [new Sequence({ value: [new ObjectIdentifier({ value: "1.2.840.10045.2.1" }), ecParameters] }), new BitString({ valueHex: point.slice().buffer })],
    });
    expect(describeCertificateKey(certWithSpki(new Uint8Array(spki.toBER(false))))).toBe("ECDSA brainpoolP256r1 (paramètres explicites)");
  });
});
