import type { LivenessActionType, LivenessChallenge, LivenessSignalFrame } from "./types";

/**
 * Frontière de capture côté mobile — seule dépendance envers la plateforme/le matériel (ARKit
 * TrueDepth sur iOS, `ARFaceTrackingConfiguration`/`ARFaceAnchor.blendShapes`). Même principe de
 * séparation que `ApduTransceiver` dans nfc/bac.ts : toute la logique de protocole (génération du
 * challenge, vérification) est pure TypeScript testée indépendamment de cette interface ; seule
 * l'implémentation native est, par nature, impossible à tester dans cet environnement (pas de
 * simulateur TrueDepth, pas d'appareil physique confirmé disponible, pas encore de compte Apple
 * Developer payant — voir docs/facial-recognition.md pour l'état exact de cette limite).
 */
export interface FaceLivenessSession {
  /** Démarre la capture pour ce challenge ; rejette si la caméra/le capteur de profondeur est indisponible ou si l'utilisateur refuse l'autorisation. */
  start(challenge: LivenessChallenge): Promise<void>;
  /** Un échantillon par frame de capture (cadence native, ex. ~30-60 Hz sur ARKit). */
  onSample(callback: (frame: LivenessSignalFrame) => void): void;
  /** Arrête la capture et renvoie tous les échantillons collectés depuis `start`. */
  stop(): Promise<LivenessSignalFrame[]>;
}

export class FaceLivenessSessionUnavailableError extends Error {}

const NEUTRAL_FRAME: Omit<LivenessSignalFrame, "timestamp"> = {
  eyeBlinkLeft: 0.02,
  eyeBlinkRight: 0.02,
  jawOpen: 0.03,
  mouthSmileLeft: 0.02,
  mouthSmileRight: 0.02,
  headYawDegrees: 0,
};

function applyActionActivation(frame: LivenessSignalFrame, action: LivenessActionType, intensity: number): void {
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

function defaultSynthesize(challenge: LivenessChallenge): LivenessSignalFrame[] {
  const frames: LivenessSignalFrame[] = [];
  const totalDurationMs = challenge.steps.length > 0 ? challenge.steps[challenge.steps.length - 1].windowEndMs : 0;

  for (let t = 0; t <= totalDurationMs; t += MOCK_SAMPLE_INTERVAL_MS) {
    const frame: LivenessSignalFrame = { timestamp: challenge.issuedAt + t, ...NEUTRAL_FRAME };
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

export interface MockFaceLivenessSessionOptions {
  /**
   * Génère les échantillons synthétiques pour ce challenge — utilisé en développement/tests
   * d'intégration UI sans matériel réel (voir apps/mobile). Par défaut, simule une réponse humaine
   * plausible : chaque action monte au milieu de sa fenêtre assignée. Permet aussi de simuler des
   * réponses non conformes (action manquante, mal chronométrée) pour tester le parcours d'échec
   * dans l'UI sans dépendre du vrai moteur de vérification.
   */
  synthesize?: (challenge: LivenessChallenge) => LivenessSignalFrame[];
}

/**
 * Implémentation mockable de `FaceLivenessSession` — ne dépend d'aucun matériel/plateforme,
 * utilisable en développement (Expo Go, simulateur iOS sans TrueDepth) et dans les tests
 * d'intégration du flux UI. N'est PAS un remplacement de la capture native réelle : produit des
 * échantillons synthétiques, jamais une preuve de vivacité.
 */
export function createMockFaceLivenessSession(options: MockFaceLivenessSessionOptions = {}): FaceLivenessSession {
  let capturedChallenge: LivenessChallenge | undefined;
  let listener: ((frame: LivenessSignalFrame) => void) | undefined;

  return {
    async start(challenge) {
      capturedChallenge = challenge;
    },
    onSample(callback) {
      listener = callback;
    },
    async stop() {
      if (!capturedChallenge) return [];
      const frames = (options.synthesize ?? defaultSynthesize)(capturedChallenge);
      if (listener) {
        for (const frame of frames) listener(frame);
      }
      return frames;
    },
  };
}
