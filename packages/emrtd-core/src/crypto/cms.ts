/**
 * Vérification de signature CMS SignerInfo (RFC 5652) contre un certificat DÉJÀ CHOISI par
 * l'appelant, sans dépendre de la recherche interne de certificat signataire de pkijs'
 * `SignedData.verify()`.
 *
 * Pourquoi : `SignedData.verify()` retrouve lui-même le certificat signataire dans
 * `signedData.certificates` en comparant `signerInfo.sid` — soit par IssuerAndSerialNumber, soit,
 * quand `sid` est un SubjectKeyIdentifier, en recalculant SHA-1(clé publique) et en le comparant
 * à `sid`. Cette dernière méthode suppose que le certificat a été émis avec un SubjectKeyIdentifier
 * calculé exactement ainsi (RFC 5280 méthode 1) — constaté faux sur une vraie Master List ICAO PKD
 * (Pays-Bas) : pkijs échoue alors avec "Unable to find signer certificate" bien que le certificat
 * signataire soit réellement présent. Comme l'appelant a déjà identifié — par sa propre logique
 * métier — QUEL certificat doit avoir signé (voir masterList.ts, sod.ts), cette recherche interne
 * est à la fois inutile et fragile : on la contourne entièrement.
 */
import { fromBER, type OctetString } from "asn1js";
import { Certificate, IssuerAndSerialNumber, type SignedData, type SignerInfo } from "pkijs";
import { verifyRawSignature, DIGEST_ALGORITHM_OID_TO_WEBCRYPTO } from "./signatureVerify";
import { hashBytes } from "./pureVerify";
import { toArrayBuffer } from "./bytes";

const CONTENT_TYPE_ATTR_OID = "1.2.840.113549.1.9.3";
const MESSAGE_DIGEST_ATTR_OID = "1.2.840.113549.1.9.4";
const SUBJECT_KEY_IDENTIFIER_EXTENSION_OID = "2.5.29.14";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Valeur déclarée (jamais recalculée) de l'extension X.509v3 SubjectKeyIdentifier, si présente. */
function declaredSubjectKeyIdentifier(cert: Certificate): Uint8Array | undefined {
  const extension = cert.extensions?.find((ext) => ext.extnID === SUBJECT_KEY_IDENTIFIER_EXTENSION_OID);
  if (!extension) return undefined;
  const outerBytes = new Uint8Array(extension.extnValue.valueBlock.valueHexView);
  const asn1 = fromBER(toArrayBuffer(outerBytes));
  if (asn1.offset === -1) return undefined;
  return new Uint8Array((asn1.result as OctetString).valueBlock.valueHexView);
}

/**
 * Retrouve, parmi les certificats embarqués dans le CMS, celui référencé par `signerInfo.sid` —
 * IssuerAndSerialNumber (comparaison exacte issuer+numéro de série) ou SubjectKeyIdentifier
 * (comparaison aux octets bruts de l'extension SubjectKeyIdentifier RÉELLEMENT DÉCLARÉE par le
 * certificat, jamais un SHA-1(clé publique) recalculé — voir docstring du module). Ne devine
 * jamais : lève une erreur plutôt que de choisir arbitrairement en cas d'ambiguïté ou d'absence
 * de correspondance, sauf le cas trivial où un seul certificat est présent.
 */
export function findCmsSignerCertificate(signerInfo: SignerInfo, certificates: Certificate[]): Certificate {
  const sid = signerInfo.sid;
  if (sid instanceof IssuerAndSerialNumber) {
    const match = certificates.find((cert) => cert.issuer.isEqual(sid.issuer) && cert.serialNumber.isEqual(sid.serialNumber));
    if (!match) {
      throw new Error("Certificat signataire introuvable : aucun certificat du CMS ne correspond à SignerInfo.sid (IssuerAndSerialNumber)");
    }
    return match;
  }

  if (certificates.length === 1) {
    return certificates[0];
  }

  const sidBytes = new Uint8Array((sid as unknown as { valueBlock: { valueHexView: Uint8Array } }).valueBlock.valueHexView);
  const match = certificates.find((cert) => {
    const ski = declaredSubjectKeyIdentifier(cert);
    return ski !== undefined && bytesEqual(ski, sidBytes);
  });
  if (!match) {
    throw new Error(
      "Certificat signataire introuvable : aucun des certificats du CMS n'a une extension SubjectKeyIdentifier correspondant à SignerInfo.sid",
    );
  }
  return match;
}

/**
 * Vérifie que `signerCertificate` a bien signé `content` via le SignerInfo à `signerIndex` du
 * SignedData donné — gère correctement le cas (quasi systématique en pratique, RFC 5652 §5.4) où
 * des signedAttrs sont présents : la signature porte alors sur les signedAttrs re-encodés (tag
 * SET universel, déjà fourni par pkijs via `signedAttrs.encodedValue`), après vérification que
 * l'attribut messageDigest y correspond bien au contenu réel — sans ce lien, un attaquant pourrait
 * substituer le contenu signé tout en gardant une signature techniquement valide sur des attributs
 * différents.
 */
export async function verifyCmsSignerInfo(params: {
  signedData: SignedData;
  signerIndex: number;
  signerCertificate: Certificate;
  content: ArrayBuffer;
}): Promise<boolean> {
  const signerInfo = params.signedData.signerInfos[params.signerIndex];
  if (!signerInfo) {
    throw new Error("SignerInfo introuvable à l'index demandé");
  }

  let dataToVerify: ArrayBuffer = params.content;

  if (signerInfo.signedAttrs) {
    const attributes = signerInfo.signedAttrs.attributes;
    const hasContentType = attributes.some((attribute) => attribute.type === CONTENT_TYPE_ATTR_OID);
    const messageDigestAttribute = attributes.find((attribute) => attribute.type === MESSAGE_DIGEST_ATTR_OID);
    if (!hasContentType) {
      throw new Error("SignedAttrs invalide : attribut contentType absent (obligatoire, RFC 5652 §11.1)");
    }
    if (!messageDigestAttribute) {
      throw new Error("SignedAttrs invalide : attribut messageDigest absent (obligatoire, RFC 5652 §11.2)");
    }

    const digestAlgorithmOid = signerInfo.digestAlgorithm.algorithmId;
    const hashName = DIGEST_ALGORITHM_OID_TO_WEBCRYPTO[digestAlgorithmOid];
    if (!hashName) {
      throw new Error(`Algorithme de hachage CMS non supporté : OID ${digestAlgorithmOid}`);
    }
    const actualDigest = hashBytes(hashName, new Uint8Array(params.content));
    const claimedDigest = new Uint8Array(messageDigestAttribute.values[0].valueBlock.valueHexView);
    if (!bytesEqual(actualDigest, claimedDigest)) {
      return false;
    }

    dataToVerify = signerInfo.signedAttrs.encodedValue;
  }

  return verifyRawSignature({
    spkiDer: new Uint8Array(params.signerCertificate.subjectPublicKeyInfo.toSchema().toBER(false)),
    signatureAlgorithmOid: signerInfo.signatureAlgorithm.algorithmId,
    signatureAlgorithmParams: signerInfo.signatureAlgorithm.algorithmParams,
    digestAlgorithmOid: signerInfo.digestAlgorithm.algorithmId,
    signature: new Uint8Array(signerInfo.signature.valueBlock.valueHexView),
    signedData: new Uint8Array(dataToVerify),
  });
}
