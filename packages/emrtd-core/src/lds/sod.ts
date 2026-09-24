import { fromBER } from "asn1js";
import { ContentInfo, SignedData, type Certificate } from "pkijs";
import type { DataGroupNumber } from "@emrtd-verify/shared-types";
import { ensurePkiEngine } from "../crypto/engine";
import { toArrayBuffer } from "../crypto/bytes";
import {
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
  parseCertificate,
} from "../crypto/x509";
import { findCmsSignerCertificate, verifyCmsSignerInfo } from "../crypto/cms";
import { decodeLdsSecurityObject } from "./ldsSecurityObjectAsn1";

/**
 * EF.SOD (Doc 9303 Part 11 §4) — CMS SignedData contenant un LDSSecurityObject.
 * Décodage réel via pkijs (CMS SignedData) + un décodeur ASN.1 dédié pour le
 * LDSSecurityObject (structure propre à la LDS, hors schéma CMS standard).
 */

export type DigestAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

export interface DataGroupHash {
  dataGroupNumber: DataGroupNumber;
  hash: Uint8Array;
}

export interface LdsSecurityObject {
  version: number;
  digestAlgorithm: DigestAlgorithm;
  dataGroupHashes: DataGroupHash[];
}

export interface DocumentSignerCertificate {
  /** DER-encoded X.509, tel que porté dans le SOD (CMS SignerInfo). */
  certificateDer: Uint8Array;
  issuer: string;
  subject: string;
  serialNumber: string;
  notBefore: string; // ISO 8601
  notAfter: string; // ISO 8601
}

export interface SecurityObjectDocument {
  ldsSecurityObject: LdsSecurityObject;
  signerCertificate: DocumentSignerCertificate;
  /** Signature CMS sur le LdsSecurityObject, à vérifier avec la clé publique du DSC. */
  signature: Uint8Array;
  signatureAlgorithm: string;
}

export interface DataGroupHashVerification {
  dataGroupNumber: DataGroupNumber;
  matches: boolean;
}

export interface DecodedSod {
  document: SecurityObjectDocument;
  /**
   * Vérifie que le SOD a bien été signé par la clé privée correspondant au certificat
   * DSC embarqué (`document.signerCertificate`). N'établit PAS que ce certificat est
   * digne de confiance — c'est le rôle de packages/pki-trust (chaîne CSCA -> DSC),
   * qui doit être validée séparément avant de faire confiance à ce résultat.
   */
  verifySignature(): Promise<boolean>;
}

/**
 * Décode un EF.SOD (CMS SignedData, Doc 9303 Part 11 §4) : extrait le LDSSecurityObject,
 * le certificat Document Signer embarqué, et prépare la vérification de signature.
 */
/**
 * EF.SOD tel que lu sur la puce est enveloppé dans une balise applicative 0x77 (Doc 9303 Part 10
 * §4.6.2 : "77 L ContentInfo") ; le CMS SignedData est à l'intérieur. Accepte aussi un ContentInfo
 * déjà nu (SEQUENCE 0x30), pour les appelants qui l'auraient extrait eux-mêmes.
 */
export function unwrapEfSod(sod: Uint8Array): Uint8Array {
  if (sod[0] !== 0x77) return sod;
  const first = sod[1];
  let length: number;
  let headerLength: number;
  if (first < 0x80) {
    length = first;
    headerLength = 2;
  } else {
    const lengthBytes = first & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 3) throw new Error(`EF.SOD : longueur de la balise 0x77 non prise en charge (0x${first.toString(16)})`);
    length = 0;
    for (let i = 0; i < lengthBytes; i++) length = (length << 8) | sod[2 + i];
    headerLength = 2 + lengthBytes;
  }
  if (headerLength + length > sod.length) throw new Error("EF.SOD tronqué : la balise 0x77 annonce plus d'octets que lus");
  return sod.subarray(headerLength, headerLength + length);
}

export function decodeSod(sodDer: Uint8Array): DecodedSod {
  ensurePkiEngine();

  const asn1 = fromBER(toArrayBuffer(unwrapEfSod(sodDer)));
  if (asn1.offset === -1) {
    throw new Error("SOD invalide : échec du décodage ASN.1 du ContentInfo");
  }

  const contentInfo = new ContentInfo({ schema: asn1.result });
  const signedData = new SignedData({ schema: contentInfo.content });

  const eContentOctetString = signedData.encapContentInfo.eContent;
  if (!eContentOctetString) {
    throw new Error("SOD invalide : eContent absent de l'encapContentInfo");
  }
  // pkijs peut représenter l'OCTET STRING eContent sous forme constructed (fragments
  // concaténés) selon le chemin d'encodage ; .getValue() gère les deux cas correctement,
  // contrairement à .valueBlock.valueHexView qui est vide sur la forme constructed.
  const eContent = eContentOctetString.getValue();

  const ldsSecurityObject = decodeLdsSecurityObject(eContent);

  const certificates = signedData.certificates;
  if (!certificates || certificates.length === 0) {
    throw new Error("SOD invalide : certificat Document Signer absent du SignedData");
  }
  const typedCertificates = certificates.filter((cert): cert is Certificate => "subject" in cert);
  if (typedCertificates.length === 0) {
    throw new Error("SOD invalide : entrée de certificat inattendue (attribute certificate ?)");
  }

  const signerInfo = signedData.signerInfos[0];
  if (!signerInfo) {
    throw new Error("SOD invalide : SignerInfo absent");
  }

  // Le DSC effectivement signataire n'est pas nécessairement le premier certificat du CMS
  // (constaté sur de vraies Master Lists ICAO PKD — voir crypto/cms.ts ; même risque théorique ici).
  const dscCertificate = findCmsSignerCertificate(signerInfo, typedCertificates);

  const { notBefore, notAfter } = certificateValidityIso(dscCertificate);
  const document: SecurityObjectDocument = {
    ldsSecurityObject,
    signerCertificate: {
      certificateDer: new Uint8Array(dscCertificate.toSchema().toBER(false)),
      issuer: distinguishedNameToString(dscCertificate.issuer),
      subject: distinguishedNameToString(dscCertificate.subject),
      serialNumber: certificateSerialNumberHex(dscCertificate),
      notBefore,
      notAfter,
    },
    signature: new Uint8Array(signerInfo.signature.valueBlock.valueHexView),
    signatureAlgorithm: signerInfo.signatureAlgorithm.algorithmId,
  };

  return {
    document,
    async verifySignature() {
      return verifyCmsSignerInfo({ signedData, signerIndex: 0, signerCertificate: dscCertificate, content: eContent });
    },
  };
}

/**
 * Compare, pour chaque DG effectivement LU, son hash calculé à celui déclaré dans le SOD (Doc 9303
 * Part 11 §5.1 : la Passive Authentication porte sur les DG lus). Un DG déclaré mais non lu (DG3
 * protégé par EAC, DG11/12/13 facultatifs…) n'est pas une incohérence : il n'apparaît pas ici — voir
 * `dataGroupsNotRead`. Un DG lu mais absent du SOD, en revanche, est une incohérence (matches=false) :
 * rien ne l'authentifie. Ne fait aucune vérification de signature — voir pki-trust/chainValidator.ts.
 */
export function verifyDataGroupHashes(
  sod: SecurityObjectDocument,
  computedHashes: DataGroupHash[],
): DataGroupHashVerification[] {
  return computedHashes.map((computed) => {
    const declared = sod.ldsSecurityObject.dataGroupHashes.find((h) => h.dataGroupNumber === computed.dataGroupNumber);
    const matches =
      declared !== undefined &&
      computed.hash.length === declared.hash.length &&
      computed.hash.every((byte, i) => byte === declared.hash[i]);
    return { dataGroupNumber: computed.dataGroupNumber, matches };
  });
}

/** DG déclarés dans le SOD mais non lus sur la puce (information, pas une anomalie). */
export function dataGroupsNotRead(sod: SecurityObjectDocument, computedHashes: DataGroupHash[]): number[] {
  return sod.ldsSecurityObject.dataGroupHashes
    .map((declared) => declared.dataGroupNumber)
    .filter((number) => !computedHashes.some((computed) => computed.dataGroupNumber === number));
}
