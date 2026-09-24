/**
 * Séquence de capture du selfie (écran « Capture vivante »), pilotée par les mesures que le module
 * natif `modules/face-kit` remonte pour chaque image : 1) visage seul, cadré, de face et immobile —
 * c'est cette image qui est comparée à la photo de la puce ; 2) tourner la tête puis revenir de
 * face ; 3) cligner des yeux. Le même visage doit rester à l'écran de bout en bout : s'il disparaît
 * ou qu'un second apparaît plus d'une seconde, tout recommence.
 *
 * Portée honnête : cette vivacité guidée écarte une photo tenue devant la caméra, pas une vidéo
 * rejouée ni un masque — ce n'est pas une détection d'attaque certifiée (ISO/IEC 30107-3).
 */

export interface FaceFrameSample {
  faceCount: number;
  /** Millisecondes. */
  timestamp: number;
  box?: { x: number; y: number; width: number; height: number };
  turn?: number;
  eyeOpenness?: number;
}

/** 0 cadrage, 1 rotation de la tête, 2 clignement, 3 terminé. */
export type SelfiePhase = 0 | 1 | 2 | 3;

export type SelfieHint = "no-face" | "multiple" | "closer" | "farther" | "center" | "face-camera" | "hold" | null;

export interface SelfieUpdate {
  phase: SelfiePhase;
  hint: SelfieHint;
  /** Vrai une seule fois : l'image courante est la bonne pour la comparaison, la demander au natif. */
  requestCapture: boolean;
}

export const SELFIE_RULES = {
  minFaceWidth: 0.3,
  maxFaceWidth: 0.8,
  centerTolerance: 0.17,
  frontalTurn: 0.12,
  turnedTurn: 0.25,
  holdMs: 700,
  lostFaceResetMs: 1000,
  blinkClosedRatio: 0.6,
  blinkOpenRatio: 0.85,
  blinkMaxMs: 900,
} as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class SelfieLivenessTracker {
  phase: SelfiePhase = 0;
  private holdStart: number | null = null;
  private holdOpenness: number[] = [];
  private baselineOpenness = 0;
  private lastSingleFace: number | null = null;
  private turned = false;
  private closedAt: number | null = null;
  private captureRequested = false;

  reset(): void {
    this.phase = 0;
    this.holdStart = null;
    this.holdOpenness = [];
    this.baselineOpenness = 0;
    this.lastSingleFace = null;
    this.turned = false;
    this.closedAt = null;
    this.captureRequested = false;
  }

  push(frame: FaceFrameSample): SelfieUpdate {
    const R = SELFIE_RULES;
    if (this.phase === 3) return { phase: 3, hint: null, requestCapture: false };

    if (frame.faceCount !== 1 || !frame.box) {
      this.holdStart = null;
      this.holdOpenness = [];
      if (this.phase > 0 && this.lastSingleFace !== null && frame.timestamp - this.lastSingleFace > R.lostFaceResetMs) {
        this.reset();
      }
      return { phase: this.phase, hint: frame.faceCount > 1 ? "multiple" : "no-face", requestCapture: false };
    }
    this.lastSingleFace = frame.timestamp;

    const turn = frame.turn ?? 0;
    const openness = frame.eyeOpenness ?? 0;
    const frontal = Math.abs(turn) < R.frontalTurn;

    if (this.phase === 0) {
      const { x, y, width, height } = frame.box;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const hint: SelfieHint =
        width < R.minFaceWidth
          ? "closer"
          : width > R.maxFaceWidth
            ? "farther"
            : Math.abs(cx - 0.5) > R.centerTolerance || Math.abs(cy - 0.5) > R.centerTolerance
              ? "center"
              : !frontal
                ? "face-camera"
                : null;
      if (hint) {
        this.holdStart = null;
        this.holdOpenness = [];
        return { phase: 0, hint, requestCapture: false };
      }
      if (this.holdStart === null) this.holdStart = frame.timestamp;
      this.holdOpenness.push(openness);
      if (frame.timestamp - this.holdStart < R.holdMs) {
        return { phase: 0, hint: "hold", requestCapture: false };
      }
      this.baselineOpenness = median(this.holdOpenness);
      this.phase = 1;
      const requestCapture = !this.captureRequested;
      this.captureRequested = true;
      return { phase: 1, hint: null, requestCapture };
    }

    if (this.phase === 1) {
      if (Math.abs(turn) >= R.turnedTurn) this.turned = true;
      if (this.turned && frontal) {
        this.phase = 2;
        return { phase: 2, hint: null, requestCapture: false };
      }
      return { phase: 1, hint: null, requestCapture: false };
    }

    // Phase 2 : clignement = fermeture nette puis réouverture rapide, visage de face.
    if (!frontal) return { phase: 2, hint: "face-camera", requestCapture: false };
    const base = this.baselineOpenness;
    if (base <= 0) return { phase: 2, hint: null, requestCapture: false };
    if (openness < base * R.blinkClosedRatio) {
      if (this.closedAt === null) this.closedAt = frame.timestamp;
    } else if (this.closedAt !== null && openness >= base * R.blinkOpenRatio) {
      const quick = frame.timestamp - this.closedAt <= R.blinkMaxMs;
      this.closedAt = null;
      if (quick) {
        this.phase = 3;
        return { phase: 3, hint: null, requestCapture: false };
      }
    }
    return { phase: 2, hint: null, requestCapture: false };
  }
}
