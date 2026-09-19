import { fromBER } from "asn1js";
import { ContentInfo, SignedData, type Certificate } from "pkijs";
import {
  ensurePkiEngine,
  toArrayBuffer,
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
  isCertificateSignedBy,
  verifyCmsSignerInfo,
  findCmsSignerCertificate,
} from "@emrtd-verify/emrtd-core";
import { decodeCscaMasterList, CSCA_MASTER_LIST_MAX_ASN1_NODES, type DecodedCscaMasterList } from "./masterListAsn1";
import type { CscaTrustAnchor } from "./trustAnchor";

/**
 * Décodage et vérification de confiance de la CSCA Master List ICAO (Doc 9303 Part 12 §8).
 *
 * Bootstrap de confiance — le point le plus critique de tout ce module : le CMS SignedData de
 * la Master List est signé par un "Master List Signer" (une entité désignée par l'ICAO, avec
 * son propre certificat — historiquement le BSI allemand a joué ce rôle). CE certificat ne peut
 * PAS être extrait du fichier téléchargé et auto-approuvé : un attaquant contrôlant le canal de
 * récupération (MITM sur le flux LDAP/HTTPS, ou compromission du miroir utilisé) fournirait alors
 * sa propre Master List signée par sa propre clé, avec son propre certificat "Master List Signer"
 * embarqué — et rien ne la distinguerait techniquement de la vraie. Le certificat du Master List
 * Signer doit être obtenu hors bande (canal sécurisé distinct de celui utilisé pour récupérer la
 * Master List elle-même) et épinglé dans `config/master-list-signer-trust-anchors.json` — voir
 * ce fichier et docs/pki-trust-model.md "Bootstrap de confiance de la Master List".
 */

export interface DecodedMasterList {
  content: DecodedCscaMasterList;
  signerCertificate: {
    certificateDer: Uint8Array;
    subject: string;
    issuer: string;
    serialNumber: string;
    notBefore: string;
    notAfter: string;
  };
  /** Vérifie uniquement que le CMS a bien été signé par la clé privée du certificat embarqué — pas qu'il est de confiance (voir verifyMasterListTrust). */
  verifySignature(): Promise<boolean>;
}

export function decodeMasterList(masterListCmsDer: Uint8Array): DecodedMasterList {
  ensurePkiEngine();

  const asn1 = fromBER(toArrayBuffer(masterListCmsDer), { maxNodes: CSCA_MASTER_LIST_MAX_ASN1_NODES });
  if (asn1.offset === -1) {
    throw new Error("Master List invalide : échec du décodage ASN.1 du ContentInfo");
  }

  const contentInfo = new ContentInfo({ schema: asn1.result });
  const signedData = new SignedData({ schema: contentInfo.content });

  const eContentOctetString = signedData.encapContentInfo.eContent;
  if (!eContentOctetString) {
    throw new Error("Master List invalide : eContent absent de l'encapContentInfo");
  }
  const eContent = eContentOctetString.getValue();
  const content = decodeCscaMasterList(eContent);

  const certificates = signedData.certificates;
  if (!certificates || certificates.length === 0) {
    throw new Error("Master List invalide : certificat du Master List Signer absent du SignedData");
  }
  const typedCertificates = certificates.filter((cert): cert is Certificate => "subject" in cert);
  if (typedCertificates.length === 0) {
    throw new Error("Master List invalide : entrée de certificat inattendue (attribute certificate ?)");
  }

  const signerInfo = signedData.signerInfos[0];
  if (!signerInfo) {
    throw new Error("Master List invalide : SignerInfo absent");
  }

  // Le certificat effectivement signataire n'est pas nécessairement le premier de la liste :
  // constaté sur de vraies Master Lists ICAO PKD (Botswana, Cameroun...) qui embarquent plusieurs
  // certificats (signataire + CSCA émettrice) — voir emrtd-core/crypto/cms.ts.
  const signerCert = findCmsSignerCertificate(signerInfo, typedCertificates);

  const { notBefore, notAfter } = certificateValidityIso(signerCert);

  return {
    content,
    signerCertificate: {
      certificateDer: new Uint8Array(signerCert.toSchema(true).toBER(false)),
      subject: distinguishedNameToString(signerCert.subject),
      issuer: distinguishedNameToString(signerCert.issuer),
      serialNumber: certificateSerialNumberHex(signerCert),
      notBefore,
      notAfter,
    },
    async verifySignature() {
      return verifyCmsSignerInfo({ signedData, signerIndex: 0, signerCertificate: signerCert, content: eContent });
    },
  };
}

export interface MasterListTrustResult {
  trusted: boolean;
  reason?: string;
  /** Le certificat, parmi `trustedDer`, qui a effectivement validé le signataire (audit). */
  trustedViaDer?: Uint8Array;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Primitive de confiance partagée : `candidateDer` est-il, parmi `trustedDers`, soit littéralement
 * l'un d'eux (comparaison directe), soit signé par l'un d'eux (chaîne courte) ? Réutilisée par :
 * - `verifyMasterListTrust` (le signataire de la Master List ICAO globale doit correspondre à une
 *   ancre épinglée hors bande) ;
 * - `verifyCountryMasterListTrust` (le signataire d'une Master List nationale doit correspondre à
 *   une CSCA DÉJÀ approuvée pour ce pays — jamais une CSCA extraite de la même Master List) ;
 * - le rollover d'une CSCA par certificat de liaison ("Link Certificate", Doc 9303 Part 12) : une
 *   nouvelle CSCA signée par une ancienne CSCA déjà approuvée est le même cas de figure.
 * Ne devine jamais : renvoie simplement `undefined` si aucune correspondance, sans favoriser un
 * candidat plutôt qu'un autre.
 */
export async function isCertificateTrustedByChain(candidateDer: Uint8Array, trustedDers: Uint8Array[]): Promise<Uint8Array | undefined> {
  for (const trustedDer of trustedDers) {
    const isPinnedDirectly = bytesEqual(candidateDer, trustedDer);
    const isSignedByTrusted = isPinnedDirectly ? false : await isCertificateSignedBy(candidateDer, trustedDer);
    if (isPinnedDirectly || isSignedByTrusted) {
      return trustedDer;
    }
  }
  return undefined;
}

/**
 * Vérifie que la Master List décodée est authentiquement signée ET que son signataire est l'une
 * des ancres de confiance épinglées — jamais l'inverse (ne fait jamais confiance à un signataire
 * simplement parce qu'il est présent dans le fichier). `trustedSignerCertificatesDer` doit
 * provenir de `config/master-list-signer-trust-anchors.json`, jamais du fichier téléchargé.
 *
 * S'applique à LA Master List ICAO globale (récupérée via `PKD_MASTER_LIST_SOURCE`) — PAS aux
 * Master Lists nationales publiées par chaque pays sous la branche LDAP `o=ml,c=XX` de l'ICAO PKD,
 * qui n'ont pas de signataire unique pinnable de cette façon (voir `verifyCountryMasterListTrust`
 * et docs/pki-trust-model.md "Modèle de confiance à deux niveaux").
 */
export async function verifyMasterListTrust(
  decoded: DecodedMasterList,
  trustedSignerCertificatesDer: Uint8Array[],
  atIso8601: string = new Date().toISOString(),
): Promise<MasterListTrustResult> {
  if (trustedSignerCertificatesDer.length === 0) {
    return {
      trusted: false,
      reason:
        "Aucune ancre de confiance Master List Signer configurée (config/master-list-signer-trust-anchors.json vide)",
    };
  }

  const signatureValid = await decoded.verifySignature();
  if (!signatureValid) {
    return { trusted: false, reason: "Signature CMS de la Master List invalide" };
  }

  if (atIso8601 < decoded.signerCertificate.notBefore || atIso8601 > decoded.signerCertificate.notAfter) {
    return { trusted: false, reason: "Certificat du Master List Signer hors période de validité" };
  }

  const trustedViaDer = await isCertificateTrustedByChain(decoded.signerCertificate.certificateDer, trustedSignerCertificatesDer);
  if (trustedViaDer) {
    return { trusted: true, trustedViaDer };
  }

  return { trusted: false, reason: "Certificat du Master List Signer non reconnu parmi les ancres épinglées" };
}

/**
 * Vérifie une Master List NATIONALE (branche LDAP ICAO PKD `o=ml,c=XX`, un CMS par pays) : son
 * signataire doit correspondre à une CSCA DÉJÀ approuvée pour CE pays (`alreadyTrustedCscaDersForCountry`
 * — typiquement issue d'un cycle précédent, elle-même validée via la Master List ICAO globale ou le
 * magasin de confiance étendu). Ne fait JAMAIS confiance à une CSCA extraite de la Master List en
 * cours de validation elle-même — cela ne prouverait qu'une auto-cohérence, pas une provenance
 * légitime (n'importe qui peut forger un CMS auto-cohérent). Voir docs/pki-trust-model.md.
 */
export async function verifyCountryMasterListTrust(
  decoded: DecodedMasterList,
  alreadyTrustedCscaDersForCountry: Uint8Array[],
  atIso8601: string = new Date().toISOString(),
): Promise<MasterListTrustResult> {
  if (alreadyTrustedCscaDersForCountry.length === 0) {
    return {
      trusted: false,
      reason: "Aucune CSCA déjà approuvée pour ce pays — impossible de valider une Master List nationale sans base de confiance préexistante",
    };
  }

  const signatureValid = await decoded.verifySignature();
  if (!signatureValid) {
    return { trusted: false, reason: "Signature CMS de la Master List nationale invalide" };
  }

  if (atIso8601 < decoded.signerCertificate.notBefore || atIso8601 > decoded.signerCertificate.notAfter) {
    return { trusted: false, reason: "Certificat du signataire de la Master List nationale hors période de validité" };
  }

  const trustedViaDer = await isCertificateTrustedByChain(decoded.signerCertificate.certificateDer, alreadyTrustedCscaDersForCountry);
  if (trustedViaDer) {
    return { trusted: true, trustedViaDer };
  }

  return {
    trusted: false,
    reason: "Signataire de la Master List nationale non relié à une CSCA déjà approuvée pour ce pays (revue manuelle nécessaire)",
  };
}

/**
 * Convertit les certificats extraits d'une Master List vérifiée en ancres de confiance, prêtes
 * pour ExtendedTrustStore/ChainValidator. Le code pays est dérivé du sujet du certificat CSCA
 * (attribut C, Doc 9303 Part 12) — un certificat sans code pays exploitable est rejeté plutôt que
 * silencieusement mal classé.
 */
export function masterListCertificatesToTrustAnchors(
  certificatesDer: Uint8Array[],
  parseCertificate: (der: Uint8Array) => {
    subject: string;
    countryCode: string | undefined;
    serialNumber: string;
    notBefore: string;
    notAfter: string;
  },
): CscaTrustAnchor[] {
  const anchors: CscaTrustAnchor[] = [];
  for (const certDer of certificatesDer) {
    const parsed = parseCertificate(certDer);
    if (!parsed.countryCode) {
      continue;
    }
    anchors.push({
      countryCode: parsed.countryCode,
      certificateDer: certDer,
      subject: parsed.subject,
      serialNumber: parsed.serialNumber,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      source: "icao-pkd",
      level: "high",
    });
  }
  return anchors;
}
