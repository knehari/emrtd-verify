import { fromBER } from "asn1js";
import { CertificateRevocationList } from "pkijs";
import { ensurePkiEngine, toArrayBuffer, bufferToHex } from "@emrtd-verify/emrtd-core";

export interface DecodedRevocationList {
  issuer: string;
  thisUpdate: string; // ISO 8601
  revokedSerialNumbersHex: string[];
}

/** Décode une CRL (Certificate Revocation List) X.509 DER — Doc 9303 Part 12 / RFC 5280 §5. */
export function decodeCrl(crlDer: Uint8Array): DecodedRevocationList {
  ensurePkiEngine();
  const asn1 = fromBER(toArrayBuffer(crlDer));
  if (asn1.offset === -1) {
    throw new Error("CRL invalide : échec du décodage ASN.1");
  }
  const crl = new CertificateRevocationList({ schema: asn1.result });

  return {
    issuer: crl.issuer.typesAndValues.map((tv) => `${tv.type}=${String(tv.value.valueBlock.value)}`).join(","),
    thisUpdate: crl.thisUpdate.value.toISOString(),
    revokedSerialNumbersHex: (crl.revokedCertificates ?? []).map((entry) =>
      bufferToHex(entry.userCertificate.valueBlock.valueHexView),
    ),
  };
}

export function isSerialNumberRevoked(crl: DecodedRevocationList, serialNumberHex: string): boolean {
  return crl.revokedSerialNumbersHex.includes(serialNumberHex.toLowerCase());
}
