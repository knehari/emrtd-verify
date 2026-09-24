import type { Certificate } from "pkijs";
import { fromBER, ObjectIdentifier } from "asn1js";
import { Certificate as PkijsCertificate } from "pkijs";
import { ensurePkiEngine } from "./engine";
import { toArrayBuffer, bufferToHex } from "./bytes";
import { verifyRawSignature } from "./signatureVerify";
import { bytesToBigInt, standardCurveName } from "./ecCurves";

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
    // Pas `child.verify(issuer)` de pkijs : il exige Web Crypto (absent sur React Native) et ne
    // connaît ni Brainpool ni les courbes explicites — voir signatureVerify.ts/pureVerify.ts.
    return await verifyRawSignature({
      spkiDer: new Uint8Array(issuer.subjectPublicKeyInfo.toSchema().toBER(false)),
      signatureAlgorithmOid: child.signatureAlgorithm.algorithmId,
      signatureAlgorithmParams: child.signatureAlgorithm.algorithmParams,
      signature: new Uint8Array(child.signatureValue.valueBlock.valueHexView),
      signedData: child.tbsView,
    });
  } catch {
    // Algorithme ou clé non pris en charge — traité comme "non vérifié", jamais comme valide.
    return false;
  }
}

const NAMED_CURVES: Record<string, string> = {
  "1.2.840.10045.3.1.7": "NIST P-256",
  "1.3.132.0.33": "NIST P-224",
  "1.3.132.0.34": "NIST P-384",
  "1.3.132.0.35": "NIST P-521",
  "1.3.36.3.3.2.8.1.1.1": "brainpoolP160r1",
  "1.3.36.3.3.2.8.1.1.3": "brainpoolP192r1",
  "1.3.36.3.3.2.8.1.1.5": "brainpoolP224r1",
  "1.3.36.3.3.2.8.1.1.7": "brainpoolP256r1",
  "1.3.36.3.3.2.8.1.1.9": "brainpoolP320r1",
  "1.3.36.3.3.2.8.1.1.11": "brainpoolP384r1",
  "1.3.36.3.3.2.8.1.1.13": "brainpoolP512r1",
};

const SIGNATURE_ALGORITHMS: Record<string, string> = {
  "1.2.840.113549.1.1.5": "RSA SHA-1",
  "1.2.840.113549.1.1.11": "RSA SHA-256",
  "1.2.840.113549.1.1.12": "RSA SHA-384",
  "1.2.840.113549.1.1.13": "RSA SHA-512",
  "1.2.840.113549.1.1.14": "RSA SHA-224",
  "1.2.840.113549.1.1.10": "RSA-PSS",
  "1.2.840.10045.4.1": "ECDSA SHA-1",
  "1.2.840.10045.4.3.1": "ECDSA SHA-224",
  "1.2.840.10045.4.3.2": "ECDSA SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA SHA-512",
};

/** Taille en bits d'un entier ASN.1 (octets de tête nuls ignorés). */
function integerBitLength(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const top = bytes[i];
  return (bytes.length - i - 1) * 8 + (top === 0 ? 0 : 32 - Math.clz32(top));
}

/**
 * Clé publique du certificat en clair pour l'affichage : « RSA 4096 bits », « ECDSA P-384 »,
 * « ECDSA brainpoolP384r1 (paramètres explicites) » — la forme explicite est la règle chez les CSCA
 * (Doc 9303 Part 12 §7.1.2 : les paramètres de domaine doivent figurer en entier).
 */
export function describeCertificateKey(cert: Certificate): string {
  const spki = cert.subjectPublicKeyInfo;
  const oid = spki.algorithm.algorithmId;
  if (oid === "1.2.840.113549.1.1.1" || oid === "1.2.840.113549.1.1.10") {
    const rsaKey = fromBER(toArrayBuffer(new Uint8Array(spki.subjectPublicKey.valueBlock.valueHexView)));
    const modulus = (rsaKey.result as unknown as { valueBlock: { value: Array<{ valueBlock: { valueHexView: Uint8Array } }> } })
      .valueBlock?.value?.[0];
    return modulus ? `RSA ${integerBitLength(new Uint8Array(modulus.valueBlock.valueHexView))} bits` : "RSA";
  }
  if (oid === "1.2.840.10045.2.1") {
    const params = spki.algorithm.algorithmParams as { valueBlock?: { toString?: () => string; value?: unknown[] } } | undefined;
    if (params instanceof ObjectIdentifier) {
      const curveOid = params.valueBlock.toString();
      return `ECDSA ${NAMED_CURVES[curveOid] ?? curveOid}`;
    }
    // SpecifiedECDomain : version, fieldID (OID, p), curve (a, b, seed?), … — p et a suffisent à
    // reconnaître une courbe standard écrite en paramètres explicites.
    type Node = { valueBlock: { value?: Node[]; valueHexView: Uint8Array } };
    const domain = (params as unknown as Node | undefined)?.valueBlock?.value;
    const prime = domain?.[1]?.valueBlock?.value?.[1]?.valueBlock.valueHexView;
    const a = domain?.[2]?.valueBlock?.value?.[0]?.valueBlock.valueHexView;
    if (!prime) return "ECDSA";
    const name = a ? standardCurveName(bytesToBigInt(new Uint8Array(prime)), bytesToBigInt(new Uint8Array(a))) : undefined;
    return `ECDSA ${name ?? `${integerBitLength(new Uint8Array(prime))} bits`} (paramètres explicites)`;
  }
  return oid;
}

/** Algorithme de signature du certificat en clair (« RSA SHA-256 », « ECDSA SHA-384 », « RSA-PSS »…). */
export function describeSignatureAlgorithm(cert: Certificate): string {
  const oid = cert.signatureAlgorithm.algorithmId;
  return SIGNATURE_ALGORITHMS[oid] ?? oid;
}
