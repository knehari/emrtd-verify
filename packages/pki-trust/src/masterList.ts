import { fromBER } from "asn1js";
import { ContentInfo, SignedData } from "pkijs";
import {
  ensurePkiEngine,
  toArrayBuffer,
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
  isCertificateSignedBy,
} from "@emrtd-verify/emrtd-core";
import { decodeCscaMasterList, type DecodedCscaMasterList } from "./masterListAsn1";
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

  const asn1 = fromBER(toArrayBuffer(masterListCmsDer));
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
  const signerCert = certificates[0];
  if (!("subject" in signerCert)) {
    throw new Error("Master List invalide : entrée de certificat inattendue (attribute certificate ?)");
  }

  const signerInfo = signedData.signerInfos[0];
  if (!signerInfo) {
    throw new Error("Master List invalide : SignerInfo absent");
  }

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
      const result = await signedData.verify({
        signer: 0,
        data: eContent,
        trustedCerts: [signerCert],
        extendedMode: true,
      });
      return result.signatureVerified === true;
    },
  };
}

export interface MasterListTrustResult {
  trusted: boolean;
  reason?: string;
}

/**
 * Vérifie que la Master List décodée est authentiquement signée ET que son signataire est l'une
 * des ancres de confiance épinglées — jamais l'inverse (ne fait jamais confiance à un signataire
 * simplement parce qu'il est présent dans le fichier). `trustedSignerCertificatesDer` doit
 * provenir de `config/master-list-signer-trust-anchors.json`, jamais du fichier téléchargé.
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

  for (const anchorDer of trustedSignerCertificatesDer) {
    // Le signataire peut soit être littéralement l'ancre épinglée (comparaison directe), soit un
    // certificat intermédiaire signé par elle (chaîne courte) — les deux cas sont légitimes selon
    // la configuration ICAO PKD du moment, voir docs/pki-trust-model.md.
    const isPinnedDirectly = bytesEqual(decoded.signerCertificate.certificateDer, anchorDer);
    const isSignedByPinnedAnchor = isPinnedDirectly
      ? false
      : await isCertificateSignedBy(decoded.signerCertificate.certificateDer, anchorDer);

    if (isPinnedDirectly || isSignedByPinnedAnchor) {
      return { trusted: true };
    }
  }

  return { trusted: false, reason: "Certificat du Master List Signer non reconnu parmi les ancres épinglées" };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
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
