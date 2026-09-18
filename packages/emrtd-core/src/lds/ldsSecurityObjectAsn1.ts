import { fromBER, Integer, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import type { DataGroupNumber } from "@emrtd-verify/shared-types";
import { toArrayBuffer } from "../crypto/bytes";
import type { DataGroupHash, DigestAlgorithm, LdsSecurityObject } from "./sod";

/**
 * LDSSecurityObject ::= SEQUENCE {
 *   version                INTEGER,
 *   hashAlgorithm           AlgorithmIdentifier,
 *   dataGroupHashValues     SEQUENCE OF DataGroupHash }
 * DataGroupHash ::= SEQUENCE { dataGroupNumber INTEGER, dataGroupHashValue OCTET STRING }
 * (Doc 9303 Part 10 §4.6.2 — structure ASN.1 propre à la LDS, hors CMS standard)
 */

const DIGEST_ALGORITHM_OIDS: Record<DigestAlgorithm, string> = {
  "SHA-256": "2.16.840.1.101.3.4.2.1",
  "SHA-384": "2.16.840.1.101.3.4.2.2",
  "SHA-512": "2.16.840.1.101.3.4.2.3",
};

const OID_TO_DIGEST_ALGORITHM = new Map<string, DigestAlgorithm>(
  Object.entries(DIGEST_ALGORITHM_OIDS).map(([alg, oid]) => [oid, alg as DigestAlgorithm]),
);

export function encodeLdsSecurityObject(object: LdsSecurityObject): Uint8Array {
  const oid = DIGEST_ALGORITHM_OIDS[object.digestAlgorithm];
  if (!oid) {
    throw new Error(`OID inconnu pour l'algorithme de hachage ${object.digestAlgorithm}`);
  }

  const sequence = new Sequence({
    value: [
      new Integer({ value: object.version }),
      new Sequence({ value: [new ObjectIdentifier({ value: oid })] }),
      new Sequence({
        value: object.dataGroupHashes.map(
          (dg) =>
            new Sequence({
              value: [
                new Integer({ value: dg.dataGroupNumber }),
                new OctetString({ valueHex: toArrayBuffer(dg.hash) }),
              ],
            }),
        ),
      }),
    ],
  });

  return new Uint8Array(sequence.toBER(false));
}

export function decodeLdsSecurityObject(eContent: ArrayBuffer): LdsSecurityObject {
  const asn1 = fromBER(eContent);
  if (asn1.offset === -1) {
    throw new Error("LDSSecurityObject invalide : échec du décodage ASN.1");
  }

  const top = asn1.result as Sequence;
  const [versionBlock, algIdBlock, hashesBlock] = top.valueBlock.value as [Integer, Sequence, Sequence];

  const oid = (algIdBlock.valueBlock.value[0] as ObjectIdentifier).valueBlock.toString();
  const digestAlgorithm = OID_TO_DIGEST_ALGORITHM.get(oid);
  if (!digestAlgorithm) {
    throw new Error(`Algorithme de hachage non supporté dans le SOD (OID ${oid})`);
  }

  const dataGroupHashes: DataGroupHash[] = hashesBlock.valueBlock.value.map((entry) => {
    const seq = entry as Sequence;
    const [numberBlock, hashBlock] = seq.valueBlock.value as [Integer, OctetString];
    return {
      dataGroupNumber: numberBlock.valueBlock.valueDec as DataGroupNumber,
      hash: new Uint8Array(hashBlock.valueBlock.valueHexView),
    };
  });

  return {
    version: versionBlock.valueBlock.valueDec,
    digestAlgorithm,
    dataGroupHashes,
  };
}
