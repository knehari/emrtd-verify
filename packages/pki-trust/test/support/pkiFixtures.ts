import { webcrypto } from "node:crypto";
import { Integer, OctetString, PrintableString, Utf8String } from "asn1js";
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
import {
  ensurePkiEngine,
  toArrayBuffer,
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
} from "@emrtd-verify/emrtd-core";
import { encodeLdsSecurityObject } from "@emrtd-verify/emrtd-core";
import type { CscaTrustAnchor } from "../../src/trustAnchor";

/** Chaîne PKI synthétique pour les tests de pki-trust — jamais importée par le code de production. */

const subtle = webcrypto.subtle;

interface GeneratedCertificate {
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

async function generateCertificate(options: {
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

export async function generateCscaAndDsc(
  countryCode: string,
  options?: { cscaNotBefore?: Date; cscaNotAfter?: Date },
): Promise<{ csca: GeneratedCertificate; dsc: GeneratedCertificate }> {
  const csca = await generateCertificate({
    commonName: `CSCA ${countryCode}`,
    countryCode,
    isCa: true,
    notBefore: options?.cscaNotBefore,
    notAfter: options?.cscaNotAfter,
  });
  const dsc = await generateCertificate({
    commonName: `DSC ${countryCode}`,
    countryCode,
    isCa: false,
    issuer: { certificate: csca.certificate, privateKey: csca.privateKey },
  });
  return { csca, dsc };
}

export function cscaToTrustAnchor(
  countryCode: string,
  csca: GeneratedCertificate,
  overrides: Partial<Pick<CscaTrustAnchor, "source" | "level">> = {},
): CscaTrustAnchor {
  const { notBefore, notAfter } = certificateValidityIso(csca.certificate);
  return {
    countryCode,
    certificateDer: csca.certificateDer,
    subject: distinguishedNameToString(csca.certificate.subject),
    serialNumber: certificateSerialNumberHex(csca.certificate),
    notBefore,
    notAfter,
    source: overrides.source ?? "icao-pkd",
    level: overrides.level ?? "high",
  };
}

const LDS_SECURITY_OBJECT_OID = "2.23.136.1.1.1";
const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";

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

export { encodeLdsSecurityObject };
