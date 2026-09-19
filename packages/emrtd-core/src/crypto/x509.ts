import type { Certificate } from "pkijs";
import { fromBER } from "asn1js";
import { Certificate as PkijsCertificate } from "pkijs";
import { ensurePkiEngine } from "./engine";
import { toArrayBuffer, bufferToHex } from "./bytes";

const OID_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
};

export function parseCertificate(der: Uint8Array): Certificate {
  ensurePkiEngine();
  const asn1 = fromBER(toArrayBuffer(der));
  if (asn1.offset === -1) {
    throw new Error("Certificat X.509 invalide : échec du décodage ASN.1");
  }
  return new PkijsCertificate({ schema: asn1.result });
}

export function distinguishedNameToString(name: Certificate["subject"]): string {
  return name.typesAndValues
    .map((tv) => `${OID_NAMES[tv.type] ?? tv.type}=${String(tv.value.valueBlock.value)}`)
    .join(",");
}

export function certificateSerialNumberHex(cert: Certificate): string {
  return bufferToHex(cert.serialNumber.valueBlock.valueHexView);
}

/** Code pays ISO 3166-1 alpha-2/3 porté par l'attribut C du sujet, si présent (Doc 9303 Part 12). */
export function certificateCountryCode(cert: Certificate): string | undefined {
  const countryAttribute = cert.subject.typesAndValues.find((tv) => tv.type === "2.5.4.6");
  const value = countryAttribute ? String(countryAttribute.value.valueBlock.value).trim() : "";
  return value.length > 0 ? value : undefined;
}

export function certificateValidityIso(cert: Certificate): { notBefore: string; notAfter: string } {
  return {
    notBefore: cert.notBefore.value.toISOString(),
    notAfter: cert.notAfter.value.toISOString(),
  };
}

/** Vérifie que `childDer` est bien signé par la clé publique portée par `issuerDer`. */
export async function isCertificateSignedBy(childDer: Uint8Array, issuerDer: Uint8Array): Promise<boolean> {
  const child = parseCertificate(childDer);
  const issuer = parseCertificate(issuerDer);
  try {
    return await child.verify(issuer);
  } catch {
    // pkijs lève plutôt que de retourner false sur certains mésappariements d'algorithme — traité comme "non vérifié".
    return false;
  }
}
