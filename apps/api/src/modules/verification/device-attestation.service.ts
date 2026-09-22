import { Injectable, Logger } from "@nestjs/common";

export type MobilePlatform = "ios" | "android";

export interface DeviceAttestationRequest {
  platform: MobilePlatform;
  /** Jeton d'attestation opaque tel que produit par App Attest (iOS, objet CBOR base64) ou Play Integrity (Android, JWS compact) — jamais interprété comme du contenu de confiance par ce service. */
  attestationToken: string;
  /** Nonce que ce jeton doit lier (typiquement `LivenessChallenge.nonce`) — garantit que l'attestation a été produite POUR cette session précise, pas rejouée depuis une session antérieure. Non vérifié tant que la chaîne cryptographique elle-même ne l'est pas (voir ci-dessous). */
  expectedNonce: string;
}

export interface DeviceAttestationResult {
  platform: MobilePlatform;
  /** `true` uniquement si la chaîne de confiance cryptographique complète a été vérifiée (certificat racine Apple App Attest / clés publiques Google Play Integrity) — TOUJOURS `false` dans cette implémentation, voir la limite documentée sur `verify()`. */
  verified: boolean;
  reason: string;
}

/**
 * Intégrité de l'application/l'appareil (App Attest iOS / Play Integrity Android) — voir
 * docs/facial-recognition.md "Intégrité de l'application et de l'appareil" pour le périmètre
 * exact. Sert de point de branchement pour la fusion multi-signaux (voir verdict.policy.ts) : un
 * appareil non attesté n'est jamais un rejet à lui seul, mais un signal de risque explicite parmi
 * d'autres — jamais silencieusement ignoré.
 *
 * VÉRIFICATION CRYPTOGRAPHIQUE RÉELLE : DÉLIBÉRÉMENT NON IMPLÉMENTÉE dans cet environnement.
 * - App Attest (iOS) : la chaîne de certificats du jeton doit être validée jusqu'à la racine
 *   "Apple App Attestation Root CA" — un certificat public mais que je n'ai reconstruit d'aucune
 *   source vérifiable ici (pas d'accès réseau à developer.apple.com pour le récupérer et le
 *   confirmer byte-exact). Même discipline que `config/master-list-signer-trust-anchors.json`
 *   (vide par conception, voir docs/pki-trust-model.md) : jamais une ancre de confiance codée en
 *   dur sans l'avoir vérifiée contre la source primaire.
 * - Play Integrity (Android) : la vérification nécessite soit un appel à l'API Google
 *   `decodeIntegrityToken` (identifiants de compte de service + accès réseau, non disponibles
 *   ici), soit la récupération périodique du jeu de clés publiques JWKS de Google (accès réseau
 *   également requis) — même limite que la synchronisation CSCA/PKD (voir docs/roadmap.md
 *   Phase 6), jamais construite à l'aveugle sans le point d'accès réel pour la vérifier.
 * Écrire un parseur CBOR/X.509 de ces formats sans un seul jeton réel (émis par un vrai Secure
 * Enclave/Play Integrity) pour le vérifier produirait une fausse impression de sécurité sur un
 * signal anti-fraude — pire que l'absence honnête du signal.
 *
 * Ce qu'il reste à construire pour compléter cette implémentation (spécification pour quiconque
 * dispose de l'accès réseau/des identifiants réels) :
 * 1. iOS : décoder le CBOR du jeton, extraire la chaîne `x5c`, valider jusqu'à la racine Apple
 *    (obtenue et vérifiée depuis developer.apple.com, jamais reconstruite de mémoire), vérifier
 *    que `nonce = SHA256(authenticatorData || SHA256(expectedNonce))` correspond à l'extension du
 *    certificat leaf (OID 1.2.840.113635.100.8.2).
 * 2. Android : appeler `decodeIntegrityToken` (Google Play Integrity API) ou vérifier la
 *    signature JWS du jeton contre le JWKS Google actuel, puis vérifier `requestDetails.nonce`.
 * 3. Faire évoluer `verified`/`reason` en conséquence — actuellement toujours `false`.
 */
@Injectable()
export class DeviceAttestationService {
  private readonly logger = new Logger(DeviceAttestationService.name);

  async verify(request: DeviceAttestationRequest): Promise<DeviceAttestationResult> {
    if (!request.attestationToken) {
      return { platform: request.platform, verified: false, reason: "attestation_token_missing" };
    }
    this.logger.warn(
      `Vérification cryptographique de l'attestation ${request.platform} non implémentée dans cet environnement (voir la documentation de ce service) — jeton reçu mais non vérifié.`,
    );
    return { platform: request.platform, verified: false, reason: "cryptographic_chain_verification_not_implemented" };
  }
}
