import { webcrypto } from "node:crypto";
import { fromBER, Integer, OctetString, PrintableString, Utf8String } from "asn1js";
import {
  AttributeTypeAndValue,
  BasicConstraints,
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  Extension,
  IssuerAndSerialNumber,
  SignedData,
  SignerInfo,
} from "pkijs";
import { ensurePkiEngine } from "../../src/crypto/engine";
import { toArrayBuffer } from "../../src/crypto/bytes";

/**
 * Génère une chaîne PKI synthétique (CSCA/DSC auto-cohérente) et un SOD réellement signé,
 * pour tester le pipeline de Passive Authentication de bout en bout sans dépendre de
 * données ICAO réelles. Réservé aux tests — jamais importé par le code de production.
 */

const subtle = webcrypto.subtle;

export interface GeneratedCertificate {
  certificateDer: Uint8Array;
  certificate: Certificate;
  privateKey: CryptoKey;
}

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

export async function generateCertificate(options: {
  commonName: string;
  countryCode: string;
  isCa: boolean;
  issuer?: { certificate: Certificate; privateKey: CryptoKey };
  notBefore?: Date;
  notAfter?: Date;
}): Promise<GeneratedCertificate> {
  ensurePkiEngine();
  const keyPair = await generateRsaKeyPair();

  const cert = new Certificate();
  cert.version = 2;
  cert.serialNumber = new Integer({ value: Math.floor(Math.random() * 1_000_000_000) });

  const subjectRdn = [
    new AttributeTypeAndValue({ type: "2.5.4.3", value: new Utf8String({ value: options.commonName }) }),
    new AttributeTypeAndValue({ type: "2.5.4.6", value: new PrintableString({ value: options.countryCode }) }),
  ];
  cert.subject.typesAndValues.push(...subjectRdn);
  cert.issuer.typesAndValues.push(...(options.issuer ? options.issuer.certificate.subject.typesAndValues : subjectRdn));

  cert.notBefore.value = options.notBefore ?? new Date(Date.now() - 60_000);
  cert.notAfter.value = options.notAfter ?? new Date(Date.now() + 365 * 24 * 3600 * 1000);

  cert.extensions = [
    new Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new BasicConstraints({ cA: options.isCa }).toSchema().toBER(false),
    }),
  ];

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  const signingKey = options.issuer ? options.issuer.privateKey : keyPair.privateKey;
  await cert.sign(signingKey, "SHA-256");

  return {
    certificateDer: new Uint8Array(cert.toSchema(true).toBER(false)),
    certificate: cert,
    privateKey: keyPair.privateKey,
  };
}

/** Génère une paire CSCA (auto-signé, CA) + DSC (signé par le CSCA, non-CA). */
export async function generateCscaAndDsc(countryCode: string): Promise<{
  csca: GeneratedCertificate;
  dsc: GeneratedCertificate;
}> {
  const csca = await generateCertificate({ commonName: `CSCA ${countryCode}`, countryCode, isCa: true });
  const dsc = await generateCertificate({
    commonName: `DSC ${countryCode}`,
    countryCode,
    isCa: false,
    issuer: { certificate: csca.certificate, privateKey: csca.privateKey },
  });
  return { csca, dsc };
}

const LDS_SECURITY_OBJECT_OID = "2.23.136.1.1.1";
const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";

/** Signe un LDSSecurityObject (DER déjà encodé) avec la clé privée du DSC, comme un vrai EF.SOD. */
export async function buildSignedSod(options: {
  ldsSecurityObjectDer: Uint8Array;
  signer: GeneratedCertificate;
}): Promise<Uint8Array> {
  ensurePkiEngine();
  const { certificate: signerCert, privateKey } = options.signer;

  const cmsSigned = new SignedData({
    version: 1,
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: LDS_SECURITY_OBJECT_OID,
      eContent: new OctetString({ valueHex: toArrayBuffer(options.ldsSecurityObjectDer) }),
    }),
    signerInfos: [
      new SignerInfo({
        version: 1,
        sid: new IssuerAndSerialNumber({ issuer: signerCert.issuer, serialNumber: signerCert.serialNumber }),
      }),
    ],
    certificates: [signerCert],
  });

  await cmsSigned.sign(privateKey, 0, "SHA-256", toArrayBuffer(options.ldsSecurityObjectDer));

  const contentInfo = new ContentInfo({ contentType: CMS_SIGNED_DATA_OID, content: cmsSigned.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

export function parseCertificateFromDer(der: Uint8Array): Certificate {
  const asn1 = fromBER(toArrayBuffer(der));
  return new Certificate({ schema: asn1.result });
}
