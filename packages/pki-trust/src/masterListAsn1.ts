import { fromBER, Integer, Sequence, Set as Asn1Set } from "asn1js";
import { toArrayBuffer } from "@emrtd-verify/emrtd-core";

/**
 * CscaMasterList ::= SEQUENCE {
 *   version     CscaMasterListVersion,   -- INTEGER, actuellement toujours v0
 *   certList    SET OF Certificate }
 * (Doc 9303 Part 12 §8 — structure ASN.1 propre à l'ICAO PKD, contenu de l'EncapsulatedContentInfo
 * d'un CMS SignedData dont l'eContentType est id-icao-cscaMasterList : 2.23.136.1.1.2, à côté de
 * id-icao-ldsSecurityObject : 2.23.136.1.1.1 utilisé pour le SOD — voir lds/ldsSecurityObjectAsn1.ts.)
 */
export const ID_ICAO_CSCA_MASTER_LIST_OID = "2.23.136.1.1.2";

export interface DecodedCscaMasterList {
  version: number;
  /** DER de chaque certificat CSCA contenu dans la liste, non encore parsés individuellement. */
  certificatesDer: Uint8Array[];
}

export function encodeCscaMasterList(list: { version: number; certificatesDer: Uint8Array[] }): Uint8Array {
  const certNodes = list.certificatesDer.map((certDer) => {
    const asn1 = fromBER(toArrayBuffer(certDer));
    if (asn1.offset === -1) {
      throw new Error("Certificat CSCA invalide dans la liste : échec du décodage ASN.1");
    }
    return asn1.result;
  });

  const sequence = new Sequence({
    value: [new Integer({ value: list.version }), new Asn1Set({ value: certNodes })],
  });

  return new Uint8Array(sequence.toBER(false));
}

export function decodeCscaMasterList(eContent: ArrayBuffer): DecodedCscaMasterList {
  const asn1 = fromBER(eContent);
  if (asn1.offset === -1) {
    throw new Error("CscaMasterList invalide : échec du décodage ASN.1");
  }

  const top = asn1.result as Sequence;
  const [versionBlock, certListBlock] = top.valueBlock.value as [Integer, Asn1Set];

  const certificatesDer = certListBlock.valueBlock.value.map((certNode) => new Uint8Array(certNode.toBER(false)));

  return { version: versionBlock.valueBlock.valueDec, certificatesDer };
}
