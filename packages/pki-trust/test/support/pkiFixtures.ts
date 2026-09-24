import { webcrypto } from "node:crypto";
import { Integer, OctetString, Primitive, PrintableString, Utf8String } from "asn1js";
import {
  AttributeTypeAndValue,
  BasicConstraints,
  Certificate,
  CertificateRevocationList,
  ContentInfo,
  CRLDistributionPoints,
  DistributionPoint,
  GeneralName,
  RevokedCertificate,
  Time,
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

export async function generateCertificate(options: {
  commonName: string;
  countryCode: string;
  isCa: boolean;
  issuer?: { certificate: Certificate; privateKey: CryptoKey };
  notBefore?: Date;
  notAfter?: Date;
  /** Ajoute une extension X.509v3 SubjectKeyIdentifier (2.5.29.14) avec CETTE valeur exacte — pour
   * reproduire un SubjectKeyIdentifier qui ne suit PAS la méthode RFC 5280 §4.2.1.2 méthode 1
   * (SHA-1 de la clé publique), comme constaté sur une vraie Master List ICAO PKD (Pays-Bas). */
  subjectKeyIdentifier?: Uint8Array;
  /** Extension CRLDistributionPoints (2.5.29.31) avec ces adresses. */
  crlDistributionPoints?: string[];
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
  if (options.subjectKeyIdentifier) {
    cert.extensions.push(
      new Extension({
        extnID: "2.5.29.14",
        critical: false,
        extnValue: new OctetString({ valueHex: toArrayBuffer(options.subjectKeyIdentifier) }).toBER(false),
      }),
    );
  }

  if (options.crlDistributionPoints) {
    const points = new CRLDistributionPoints({
      distributionPoints: options.crlDistributionPoints.map(
        (url) => new DistributionPoint({ distributionPoint: [new GeneralName({ type: 6, value: url })] }),
      ),
    });
    cert.extensions.push(new Extension({ extnID: "2.5.29.31", critical: false, extnValue: points.toSchema().toBER(false) }));
  }

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
const CSCA_MASTER_LIST_OID = "2.23.136.1.1.2";
const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";

async function buildSignedCms(options: {
  eContentType: string;
  contentDer: Uint8Array;
  signer: GeneratedCertificate;
  /** Certificats CMS additionnels publiés à côté du signataire (ex. la CSCA émettrice) — pour
   * reproduire un CMS à plusieurs certificats où le signataire n'est PAS le premier de la liste,
   * comme constaté sur une vraie Master List ICAO PKD (Botswana). */
  extraCertificatesBefore?: Certificate[];
  /** SubjectKeyIdentifier en octets bruts, pour signer avec un sid CHOICE [0] plutôt que le
   * IssuerAndSerialNumber par défaut. */
  sidSubjectKeyIdentifier?: Uint8Array;
}): Promise<Uint8Array> {
  ensurePkiEngine();
  const { certificate: signerCert, privateKey } = options.signer;

  // Forme "[0] IMPLICIT SubjectKeyIdentifier" réellement constatée (ICAO PKD Pays-Bas) : un
  // OctetString construit normalement sérialise toujours avec le tag universel OCTET STRING (04)
  // même avec un idBlock personnalisé — seul asn1js.Primitive respecte le tag de contexte demandé.
  const sid = options.sidSubjectKeyIdentifier
    ? new Primitive({ idBlock: { tagClass: 3, tagNumber: 0 }, valueHex: toArrayBuffer(options.sidSubjectKeyIdentifier) })
    : new IssuerAndSerialNumber({ issuer: signerCert.issuer, serialNumber: signerCert.serialNumber });

  const cmsSigned = new SignedData({
    version: 1,
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: options.eContentType,
      eContent: new OctetString({ valueHex: toArrayBuffer(options.contentDer) }),
    }),
    signerInfos: [new SignerInfo({ version: 1, sid })],
    certificates: [...(options.extraCertificatesBefore ?? []), signerCert],
  });

  await cmsSigned.sign(privateKey, 0, "SHA-256", toArrayBuffer(options.contentDer));

  const contentInfo = new ContentInfo({ contentType: CMS_SIGNED_DATA_OID, content: cmsSigned.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

export async function buildSignedSod(options: {
  ldsSecurityObjectDer: Uint8Array;
  signer: GeneratedCertificate;
  extraCertificatesBefore?: Certificate[];
  sidSubjectKeyIdentifier?: Uint8Array;
}): Promise<Uint8Array> {
  return buildSignedCms({
    eContentType: LDS_SECURITY_OBJECT_OID,
    contentDer: options.ldsSecurityObjectDer,
    signer: options.signer,
    extraCertificatesBefore: options.extraCertificatesBefore,
    sidSubjectKeyIdentifier: options.sidSubjectKeyIdentifier,
  });
}

export async function buildSignedMasterList(options: {
  cscaMasterListDer: Uint8Array;
  signer: GeneratedCertificate;
  extraCertificatesBefore?: Certificate[];
  sidSubjectKeyIdentifier?: Uint8Array;
}): Promise<Uint8Array> {
  return buildSignedCms({
    eContentType: CSCA_MASTER_LIST_OID,
    contentDer: options.cscaMasterListDer,
    signer: options.signer,
    extraCertificatesBefore: options.extraCertificatesBefore,
    sidSubjectKeyIdentifier: options.sidSubjectKeyIdentifier,
  });
}

export { encodeLdsSecurityObject };

/** CRL X.509 v2 signée par `issuer` (CSCA de test), révoquant les certificats donnés. */
export async function buildSignedCrl(options: {
  issuer: GeneratedCertificate;
  revoked: Certificate[];
  thisUpdate?: Date;
  nextUpdate?: Date;
}): Promise<Uint8Array> {
  ensurePkiEngine();
  const crl = new CertificateRevocationList();
  crl.version = 1;
  crl.issuer.typesAndValues = options.issuer.certificate.subject.typesAndValues;
  crl.thisUpdate = new Time({ type: 0, value: options.thisUpdate ?? new Date(Date.now() - 60_000) });
  crl.nextUpdate = new Time({ type: 0, value: options.nextUpdate ?? new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  if (options.revoked.length > 0) {
    crl.revokedCertificates = options.revoked.map(
      (certificate) =>
        new RevokedCertificate({ userCertificate: certificate.serialNumber, revocationDate: new Time({ type: 0, value: new Date() }) }),
    );
  }
  await crl.sign(options.issuer.privateKey, "SHA-256");
  return new Uint8Array(crl.toSchema(true).toBER(false));
}
