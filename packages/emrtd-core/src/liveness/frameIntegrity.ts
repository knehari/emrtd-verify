import { sha256Hex } from "../crypto/sha256";
import type { LivenessChallenge, LivenessSignalFrame } from "./types";

/**
 * Hash-chaînage des échantillons de capture (même principe que le compteur SSC de la messagerie
 * sécurisée BAC, voir nfc/secureMessaging.ts) : chaque frame est liée cryptographiquement à la
 * précédente, et la première au nonce du challenge lui-même. Un attaquant qui veut substituer,
 * réordonner ou insérer une frame après coup doit donc recalculer TOUT le reste de la chaîne à
 * partir de ce point — sans quoi la vérification échoue au premier maillon rompu.
 *
 * Limite honnête : ce hash-chaînage est calculé côté client (l'appareil qui capture), sur des
 * données que l'attaquant contrôle in fine s'il compromet totalement l'application — il ne prouve
 * donc pas, à lui seul, qu'une frame provient physiquement du capteur caméra. Combiné à
 * l'attestation d'intégrité de l'application/l'appareil (voir deviceAttestation.ts) et à la
 * brièveté de la session (LivenessChallenge.expiresAt), il élève significativement le coût d'une
 * attaque par injection de frames sans prétendre l'éliminer structurellement — contrairement à la
 * garantie de profondeur 3D d'ARKit (voir session.ts), qui est une propriété physique, pas
 * seulement cryptographique.
 */

const GENESIS_LINK_PREFIX = "liveness-frame-chain-genesis:";

function canonicalFrameInput(frame: Pick<LivenessSignalFrame, "frameIndex" | "timestamp" | "eyeBlinkLeft" | "eyeBlinkRight" | "jawOpen" | "mouthSmileLeft" | "mouthSmileRight" | "headYawDegrees">, previousHash: string): string {
  return JSON.stringify({
    frameIndex: frame.frameIndex,
    timestamp: frame.timestamp,
    eyeBlinkLeft: frame.eyeBlinkLeft,
    eyeBlinkRight: frame.eyeBlinkRight,
    jawOpen: frame.jawOpen,
    mouthSmileLeft: frame.mouthSmileLeft,
    mouthSmileRight: frame.mouthSmileRight,
    headYawDegrees: frame.headYawDegrees,
    previousHash,
  });
}

/** Recalcule le hash attendu d'une frame à partir de son contenu et du hash de la frame précédente — utilisé aussi bien pour construire la chaîne (capture) que pour la vérifier (serveur), garantissant qu'elles restent en accord par construction. */
export function computeFrameHash(
  frame: Pick<LivenessSignalFrame, "frameIndex" | "timestamp" | "eyeBlinkLeft" | "eyeBlinkRight" | "jawOpen" | "mouthSmileLeft" | "mouthSmileRight" | "headYawDegrees">,
  previousHash: string,
): string {
  return sha256Hex(new TextEncoder().encode(canonicalFrameInput(frame, previousHash)));
}

/** Hash "génésis" liant la première frame de la chaîne au nonce du challenge — empêche de rejouer une chaîne valide enregistrée pour un AUTRE challenge (nonce différent = chaîne entièrement différente dès la première frame). */
export function genesisHash(challengeNonce: string): string {
  return sha256Hex(new TextEncoder().encode(GENESIS_LINK_PREFIX + challengeNonce));
}

/** Construit une chaîne de frames valide à partir de données brutes (sans frameIndex/frameHash) — utilisé par la session mockable (session.ts) et par les tests pour ne pas avoir à calculer les hachages à la main. */
export function chainFrames(
  challenge: Pick<LivenessChallenge, "nonce">,
  frames: ReadonlyArray<Omit<LivenessSignalFrame, "frameIndex" | "frameHash">>,
): LivenessSignalFrame[] {
  const chained: LivenessSignalFrame[] = [];
  let previousHash = genesisHash(challenge.nonce);
  frames.forEach((partial, frameIndex) => {
    const withIndex = { ...partial, frameIndex };
    const frameHash = computeFrameHash(withIndex, previousHash);
    chained.push({ ...withIndex, frameHash });
    previousHash = frameHash;
  });
  return chained;
}

export interface FrameChainVerification {
  intact: boolean;
  reasons: string[];
}

/** Vérifie la continuité de la chaîne : index strictement séquentiel depuis 0, chaque hash correctement dérivé du contenu de sa frame et du hash précédent (ou du hash génésis pour la première). S'arrête au premier maillon rompu plutôt que de continuer à vérifier une chaîne déjà invalidée. */
export function verifyFrameChain(challenge: LivenessChallenge, samples: ReadonlyArray<LivenessSignalFrame>): FrameChainVerification {
  const reasons: string[] = [];
  let previousHash = genesisHash(challenge.nonce);

  for (let position = 0; position < samples.length; position++) {
    const frame = samples[position];
    if (frame.frameIndex !== position) {
      reasons.push(`frame_index_out_of_sequence_at_position_${position}`);
      break;
    }
    const expectedHash = computeFrameHash(frame, previousHash);
    if (expectedHash !== frame.frameHash) {
      reasons.push(`frame_hash_chain_broken_at_index_${position}`);
      break;
    }
    previousHash = frame.frameHash;
  }

  return { intact: reasons.length === 0, reasons };
}
