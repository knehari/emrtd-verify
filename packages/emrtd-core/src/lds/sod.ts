import { fromBER } from "asn1js";
import { ContentInfo, SignedData } from "pkijs";
import type { DataGroupNumber } from "@emrtd-verify/shared-types";
import { ensurePkiEngine } from "../crypto/engine";
import { toArrayBuffer } from "../crypto/bytes";
import {
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
  parseCertificate,
} from "../crypto/x509";
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
export function decodeSod(sodDer: Uint8Array): DecodedSod {
  ensurePkiEngine();

  const asn1 = fromBER(toArrayBuffer(sodDer));
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
  const dscCertificate = certificates[0];
  if (!("subject" in dscCertificate)) {
    throw new Error("SOD invalide : entrée de certificat inattendue (attribute certificate ?)");
  }

  const signerInfo = signedData.signerInfos[0];
  if (!signerInfo) {
    throw new Error("SOD invalide : SignerInfo absent");
  }

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
      const result = await signedData.verify({
        signer: 0,
        data: eContent,
        trustedCerts: [dscCertificate],
        extendedMode: true,
      });
      return result.signatureVerified === true;
    },
  };
}

/**
 * Compare les hashs déclarés dans le SOD aux hashs réellement calculés sur les DG lus.
 * Ne fait aucune vérification de signature — voir packages/pki-trust/src/chainValidator.ts.
 */
export function verifyDataGroupHashes(
  sod: SecurityObjectDocument,
  computedHashes: DataGroupHash[],
): DataGroupHashVerification[] {
  return sod.ldsSecurityObject.dataGroupHashes.map((declared) => {
    const computed = computedHashes.find((h) => h.dataGroupNumber === declared.dataGroupNumber);
    const matches =
      computed !== undefined &&
      computed.hash.length === declared.hash.length &&
      computed.hash.every((byte, i) => byte === declared.hash[i]);
    return { dataGroupNumber: declared.dataGroupNumber, matches };
  });
}
