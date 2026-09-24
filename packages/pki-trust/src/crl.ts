import { fromBER } from "asn1js";
import { CertificateRevocationList } from "pkijs";
import {
  ensurePkiEngine,
  toArrayBuffer,
  bufferToHex,
  parseCertificate,
  distinguishedNameToString,
  verifyRawSignature,
} from "@emrtd-verify/emrtd-core";

export interface DecodedRevocationList {
  issuer: string;
  thisUpdate: string; // ISO 8601
  /** Date avant laquelle l'émetteur s'engage à publier la CRL suivante (absente sur certaines CRL). */
  nextUpdate?: string;
  revokedSerialNumbersHex: string[];
}

/** CRL dont la signature a été vérifiée contre un CSCA de confiance (voir `verifyRevocationList`). */
export interface VerifiedRevocationList extends DecodedRevocationList {
  /** Sujet du CSCA dont la clé a signé la CRL. */
  signerSubject: string;
  /** true si `nextUpdate` est dépassée : la liste reste valable pour les révocations qu'elle porte. */
  stale: boolean;
}

function parseCrl(crlDer: Uint8Array): CertificateRevocationList {
  ensurePkiEngine();
  const asn1 = fromBER(toArrayBuffer(crlDer));
  if (asn1.offset === -1) {
    throw new Error("CRL invalide : échec du décodage ASN.1");
  }
  return new CertificateRevocationList({ schema: asn1.result });
}

/** Décode une CRL (Certificate Revocation List) X.509 DER — Doc 9303 Part 12 / RFC 5280 §5. */
export function decodeCrl(crlDer: Uint8Array): DecodedRevocationList {
  const crl = parseCrl(crlDer);
  return {
    issuer: distinguishedNameToString(crl.issuer),
    thisUpdate: crl.thisUpdate.value.toISOString(),
    nextUpdate: crl.nextUpdate?.value.toISOString(),
    revokedSerialNumbersHex: (crl.revokedCertificates ?? []).map((entry) =>
      bufferToHex(entry.userCertificate.valueBlock.valueHexView),
    ),
  };
}

/**
 * Vérifie une CRL de CSCA (Doc 9303 Part 12 §7.1.4) avant tout usage : émetteur égal au sujet d'un
 * des CSCA de confiance fournis, ET signature valide sous sa clé — une CRL téléchargée ou lue dans
 * un cache n'est jamais crue sur parole (elle pourrait « dé-révoquer » un DSC). `undefined` si
 * aucun CSCA ne la signe.
 */
export async function verifyRevocationList(
  crlDer: Uint8Array,
  trustedCscaDers: Uint8Array[],
  atIso8601: string = new Date().toISOString(),
): Promise<VerifiedRevocationList | undefined> {
  let crl: CertificateRevocationList;
  try {
    crl = parseCrl(crlDer);
  } catch {
    return undefined;
  }
  const issuer = distinguishedNameToString(crl.issuer);
  for (const cscaDer of trustedCscaDers) {
    const csca = parseCertificate(cscaDer);
    const subject = distinguishedNameToString(csca.subject);
    if (subject !== issuer) continue;
    let signatureValid = false;
    try {
      signatureValid = await verifyRawSignature({
        spkiDer: new Uint8Array(csca.subjectPublicKeyInfo.toSchema().toBER(false)),
        signatureAlgorithmOid: crl.signatureAlgorithm.algorithmId,
        signatureAlgorithmParams: crl.signatureAlgorithm.algorithmParams,
        signature: new Uint8Array(crl.signatureValue.valueBlock.valueHexView),
        signedData: crl.tbsView,
      });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) continue;
    const decoded = decodeCrl(crlDer);
    return { ...decoded, signerSubject: subject, stale: decoded.nextUpdate !== undefined && decoded.nextUpdate < atIso8601 };
  }
  return undefined;
}

/** Adresses HTTP(S) de publication de CRL annoncées par un certificat (extension 2.5.29.31). */
export function crlDistributionPointUrls(certificateDer: Uint8Array): string[] {
  const cert = parseCertificate(certificateDer);
  const extension = cert.extensions?.find((e) => e.extnID === "2.5.29.31");
  const parsed = extension?.parsedValue as
    | { distributionPoints?: Array<{ distributionPoint?: Array<{ type: number; value: unknown }> | unknown }> }
    | undefined;
  const urls: string[] = [];
  for (const point of parsed?.distributionPoints ?? []) {
    if (!Array.isArray(point.distributionPoint)) continue; // nameRelativeToCRLIssuer : sans adresse
    for (const name of point.distributionPoint) {
      if (name.type === 6 && typeof name.value === "string" && /^https?:\/\//i.test(name.value)) urls.push(name.value.trim());
    }
  }
  return [...new Set(urls)];
}

export function isSerialNumberRevoked(crl: DecodedRevocationList, serialNumberHex: string): boolean {
  return crl.revokedSerialNumbersHex.includes(serialNumberHex.toLowerCase());
}
