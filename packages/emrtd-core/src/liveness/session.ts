import type { LightSignalSample, LivenessActionType, LivenessChallenge, LivenessSignalFrame } from "./types";
import { chainFrames } from "./frameIntegrity";

/**
 * Frontière de capture côté mobile — seule dépendance envers la plateforme/le matériel (ARKit
 * TrueDepth sur iOS, `ARFaceTrackingConfiguration`/`ARFaceAnchor.blendShapes`, plus la lecture de
 * la lumière perçue/reflétée pour le canal `lightSamples` si le challenge lumineux est activé).
 * Même principe de séparation que `ApduTransceiver` dans nfc/bac.ts : toute la logique de
 * protocole (génération du challenge, vérification) est pure TypeScript testée indépendamment de
 * cette interface ; seule l'implémentation native est, par nature, impossible à tester dans cet
 * environnement (pas de simulateur TrueDepth, pas d'appareil physique confirmé disponible, pas
 * encore de compte Apple Developer payant — voir docs/facial-recognition.md pour l'état exact de
 * cette limite).
 */
export interface FaceLivenessSession {
  /** Démarre la capture pour ce challenge ; rejette si la caméra/le capteur de profondeur est indisponible ou si l'utilisateur refuse l'autorisation. */
  start(challenge: LivenessChallenge): Promise<void>;
  /** Un échantillon par frame de capture (cadence native, ex. ~30-60 Hz sur ARKit) — `frameIndex`/`frameHash` doivent être renseignés par l'implémentation via `chainFrames`/`computeFrameHash` (frameIntegrity.ts), jamais laissés à une valeur arbitraire. */
  onSample(callback: (frame: LivenessSignalFrame) => void): void;
  /** Échantillons de lumière perçue/reflétée — appelé uniquement si `challenge.lightSequence` est présent. */
  onLightSample(callback: (sample: LightSignalSample) => void): void;
  /** Arrête la capture et renvoie tous les échantillons collectés depuis `start`. `lightSamples` est un tableau vide si aucun challenge lumineux n'était demandé. */
  stop(): Promise<{ samples: LivenessSignalFrame[]; lightSamples: LightSignalSample[] }>;
}

export class FaceLivenessSessionUnavailableError extends Error {}

const NEUTRAL_FRAME: Omit<LivenessSignalFrame, "timestamp" | "frameIndex" | "frameHash"> = {
  eyeBlinkLeft: 0.02,
  eyeBlinkRight: 0.02,
  jawOpen: 0.03,
  mouthSmileLeft: 0.02,
  mouthSmileRight: 0.02,
  headYawDegrees: 0,
};

type RawFrame = Omit<LivenessSignalFrame, "frameIndex" | "frameHash">;

function applyActionActivation(frame: RawFrame, action: LivenessActionType, intensity: number): void {
  switch (action) {
    case "blink":
      frame.eyeBlinkLeft = intensity;
      frame.eyeBlinkRight = intensity;
      break;
    case "open_mouth":
      frame.jawOpen = intensity;
      break;
    case "smile":
      frame.mouthSmileLeft = intensity;
      frame.mouthSmileRight = intensity;
      break;
    case "turn_head_left":
      frame.headYawDegrees = -25 * intensity;
      break;
    case "turn_head_right":
      frame.headYawDegrees = 25 * intensity;
      break;
  }
}

const MOCK_SAMPLE_INTERVAL_MS = 33; // ~30 Hz, cadence ARKit typique
const MOCK_ACTION_MARGIN_MS = 300; // déclenche l'action au milieu de sa fenêtre, jamais pile aux bornes

function defaultSynthesize(challenge: LivenessChallenge): RawFrame[] {
  const frames: RawFrame[] = [];
  const totalDurationMs = challenge.steps.length > 0 ? challenge.steps[challenge.steps.length - 1].windowEndMs : 0;

  for (let t = 0; t <= totalDurationMs; t += MOCK_SAMPLE_INTERVAL_MS) {
    const frame: RawFrame = { timestamp: challenge.issuedAt + t, ...NEUTRAL_FRAME };
    const activeStep = challenge.steps.find(
      (s) => t >= s.windowStartMs + MOCK_ACTION_MARGIN_MS && t <= s.windowEndMs - MOCK_ACTION_MARGIN_MS,
    );
    if (activeStep) {
      applyActionActivation(frame, activeStep.action, 0.9);
    }
    frames.push(frame);
  }
  return frames;
}

/** Réponse par défaut au challenge lumineux : reflète exactement la couleur émise à chaque étape (réponse "parfaite" pour le développement — voir `verifyLightChallenge`, verify.ts, pour la tolérance appliquée côté vérification). */
function defaultSynthesizeLight(challenge: LivenessChallenge): LightSignalSample[] {
  if (!challenge.lightSequence) return [];
  return challenge.lightSequence.map((step) => ({
    timestamp: challenge.issuedAt + step.atMs,
    perceivedColor: { ...step.color },
  }));
}

export interface MockFaceLivenessSessionOptions {
  /**
   * Génère les échantillons synthétiques (canal actions faciales) pour ce challenge — utilisé en
   * développement/tests d'intégration UI sans matériel réel (voir apps/mobile). Par défaut, simule
   * une réponse humaine plausible : chaque action monte au milieu de sa fenêtre assignée. Renvoie
   * des frames SANS `frameIndex`/`frameHash` — le hash-chaînage est appliqué automatiquement (voir
   * `chainFrames`, frameIntegrity.ts), pour ne pas alourdir un synthétiseur personnalisé simulant
   * une réponse non conforme (action manquante, mal chronométrée) pour tester le parcours d'échec.
   */
  synthesize?: (challenge: LivenessChallenge) => RawFrame[];
  /** Génère les échantillons du canal challenge lumineux — par défaut, reflète exactement la séquence émise. */
  synthesizeLight?: (challenge: LivenessChallenge) => LightSignalSample[];
}

/**
 * Implémentation mockable de `FaceLivenessSession` — ne dépend d'aucun matériel/plateforme,
 * utilisable en développement (Expo Go, simulateur iOS sans TrueDepth) et dans les tests
 * d'intégration du flux UI. N'est PAS un remplacement de la capture native réelle : produit des
 * échantillons synthétiques, jamais une preuve de vivacité.
 */
export function createMockFaceLivenessSession(options: MockFaceLivenessSessionOptions = {}): FaceLivenessSession {
  let capturedChallenge: LivenessChallenge | undefined;
  let sampleListener: ((frame: LivenessSignalFrame) => void) | undefined;
  let lightListener: ((sample: LightSignalSample) => void) | undefined;

  return {
    async start(challenge) {
      capturedChallenge = challenge;
    },
    onSample(callback) {
      sampleListener = callback;
    },
    onLightSample(callback) {
      lightListener = callback;
    },
    async stop() {
      if (!capturedChallenge) return { samples: [], lightSamples: [] };
      const rawFrames = (options.synthesize ?? defaultSynthesize)(capturedChallenge);
      const samples = chainFrames(capturedChallenge, rawFrames);
      const lightSamples = (options.synthesizeLight ?? defaultSynthesizeLight)(capturedChallenge);

      if (sampleListener) {
        for (const frame of samples) sampleListener(frame);
      }
      if (lightListener) {
        for (const sample of lightSamples) lightListener(sample);
      }
      return { samples, lightSamples };
    },
  };
}
