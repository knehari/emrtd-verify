import type { DataGroupNumber } from "@emrtd-verify/shared-types";

/**
 * EF.SOD (Doc 9303 Part 11 §4) — CMS SignedData contenant un LDSSecurityObject.
 * Cette interface décrit la structure une fois décodée (ASN.1/BER-TLV) ;
 * le décodage lui-même est délégué à packages/pki-trust (dépendance sur une lib ASN.1,
 * ex. asn1js/pkijs) — voir docs/roadmap.md Phase 1.
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
