import {
  chainFrames,
  verifyLivenessResponse,
  type LightSignalSample,
  type LivenessActionType,
  type LivenessChallenge,
  type LivenessSignalFrame,
  type LivenessVerificationResult,
} from "@emrtd-verify/emrtd-core";
import type { ActiveLivenessSubmission, IssuedLivenessChallenge } from "../backend/backendClient";

/**
 * Exécution côté mobile du défi de vivacité active (packages/emrtd-core/src/liveness) avec les
 * mesures ARKit TrueDepth de modules/face-kit (FaceLivenessView) — logique pure, testable sans
 * appareil ; l'écran (authentik/screens/SelfieScreen.tsx) ne fait qu'afficher les consignes.
 *
 * - Horloge : les fenêtres du défi sont comptées depuis `issuedAt`, heure du SERVEUR. L'écart avec
 *   l'horloge du téléphone est estimé à la réception du défi (milieu de l'aller-retour), et chaque
 *   image est ré-horodatée sur l'heure serveur.
 * - Canal actions : images suivies postérieures à `issuedAt`, chaînées (`chainFrames`, frameIntegrity.ts).
 * - Continuité : toutes les images du défi — et le selfie capturé ensuite — doivent venir du même
 *   visage suivi sans interruption par ARKit (même `anchorId`).
 * - Canal lumineux (clients à politique stricte) : pour chaque couleur affichée, la couleur de la
 *   peau mesurée 150 à 450 ms après le changement, moins le niveau ambiant (bas percentile par
 *   composante sur le défi) et normalisée — la part de lumière réfléchie venant de l'écran.
 */

/** Une image de FaceLivenessView (`onLivenessFrame`), horloge du téléphone. */
export interface ArkitLivenessFrame {
  timestamp: number;
  tracked: boolean;
  anchorId?: string;
  eyeBlinkLeft?: number;
  eyeBlinkRight?: number;
  jawOpen?: number;
  mouthSmileLeft?: number;
  mouthSmileRight?: number;
  headYawDegrees?: number;
  perceivedColor?: { r: number; g: number; b: number };
}

type Rgb = { r: number; g: number; b: number };

interface RecordedFrame {
  serverTimestamp: number;
  anchorId?: string;
  signal: Omit<LivenessSignalFrame, "frameIndex" | "frameHash">;
  color?: Rgb;
}

/** Délai entre un changement de couleur et les images qui le mesurent (affichage + exposition). */
const LIGHT_SETTLE_MS = 150;
const LIGHT_MEASURE_END_MS = 450;
/** Durée d'une couleur à l'écran (challenge.ts `LIGHT_STEP_INTERVAL_MS`). */
const LIGHT_STEP_DURATION_MS = 1500;

/** Écart horloge serveur − horloge du téléphone, estimé au milieu de l'aller-retour de la requête. */
export function serverClockOffset(issued: Pick<IssuedLivenessChallenge, "challenge" | "sentAt" | "receivedAt">): number {
  return issued.challenge.issuedAt - (issued.sentAt + issued.receivedAt) / 2;
}

export type ChallengePhase =
  | { kind: "lead"; remainingMs: number; next: LivenessActionType }
  | { kind: "step"; index: number; action: LivenessActionType; remainingMs: number }
  | { kind: "gap"; nextIndex: number; next: LivenessActionType }
  | { kind: "done" };

/** Où en est le défi à l'heure serveur `serverNow` : consigne à afficher. */
export function challengePhaseAt(challenge: LivenessChallenge, serverNow: number): ChallengePhase {
  const t = serverNow - challenge.issuedAt;
  const steps = challenge.steps;
  if (steps.length === 0) return { kind: "done" };
  if (t < steps[0].windowStartMs) return { kind: "lead", remainingMs: steps[0].windowStartMs - t, next: steps[0].action };
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (t >= step.windowStartMs && t <= step.windowEndMs) return { kind: "step", index, action: step.action, remainingMs: step.windowEndMs - t };
    const next = steps[index + 1];
    if (next && t > step.windowEndMs && t < next.windowStartMs) return { kind: "gap", nextIndex: index + 1, next: next.action };
  }
  return { kind: "done" };
}

/** Couleur à afficher en plein écran à l'heure serveur `serverNow` (défi lumineux), sinon null. */
export function lightColorAt(challenge: LivenessChallenge, serverNow: number): Rgb | null {
  const sequence = challenge.lightSequence;
  if (!sequence || sequence.length === 0) return null;
  const t = serverNow - challenge.issuedAt;
  let current: Rgb | null = null;
  for (const step of sequence) {
    if (step.atMs <= t) current = step.color;
  }
  const last = sequence[sequence.length - 1];
  return t > last.atMs + LIGHT_STEP_DURATION_MS ? null : current;
}

/** Fin du défi (heure serveur) : dernière fenêtre d'action ou dernière mesure de couleur. */
export function challengeEndsAt(challenge: LivenessChallenge): number {
  const lastWindow = challenge.steps.length > 0 ? challenge.steps[challenge.steps.length - 1].windowEndMs : 0;
  const lastLight = challenge.lightSequence?.length ? challenge.lightSequence[challenge.lightSequence.length - 1].atMs + LIGHT_MEASURE_END_MS : 0;
  return challenge.issuedAt + Math.max(lastWindow, lastLight);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface ActiveLivenessOutcome {
  submission: ActiveLivenessSubmission;
  /** Vérification locale, avec les mêmes règles que le serveur : permet de recommencer tout de suite. */
  check: LivenessVerificationResult;
  /** Visage suivi pendant tout le défi, sans interruption (un seul `anchorId`), sinon null. */
  anchorId: string | null;
  trackingInterrupted: boolean;
}

export class ActiveLivenessRecorder {
  readonly challenge: LivenessChallenge;
  readonly signature: string;
  /** Heure serveur − heure du téléphone. */
  readonly clockOffsetMs: number;
  /** Heure serveur à laquelle l'écran a pu commencer à afficher le défi (réception). */
  private readonly displayStartedAt: number;
  private readonly frames: RecordedFrame[] = [];

  constructor(issued: IssuedLivenessChallenge) {
    this.challenge = issued.challenge;
    this.signature = issued.signature;
    this.clockOffsetMs = serverClockOffset(issued);
    this.displayStartedAt = issued.receivedAt + this.clockOffsetMs;
  }

  /** Heure serveur correspondant à une heure du téléphone. */
  toServerTime(localTime: number): number {
    return localTime + this.clockOffsetMs;
  }

  /** Enregistre une image ARKit ; ignorée si aucun visage n'est suivi ou hors de la durée du défi. */
  push(frame: ArkitLivenessFrame): void {
    if (!frame.tracked) return;
    const serverTimestamp = Math.round(this.toServerTime(frame.timestamp));
    if (serverTimestamp < this.challenge.issuedAt || serverTimestamp > challengeEndsAt(this.challenge)) return;
    const previous = this.frames[this.frames.length - 1];
    if (previous && serverTimestamp <= previous.serverTimestamp) return; // horodatages strictement croissants
    this.frames.push({
      serverTimestamp,
      anchorId: frame.anchorId,
      signal: {
        timestamp: serverTimestamp,
        eyeBlinkLeft: round(frame.eyeBlinkLeft ?? 0, 4),
        eyeBlinkRight: round(frame.eyeBlinkRight ?? 0, 4),
        jawOpen: round(frame.jawOpen ?? 0, 4),
        mouthSmileLeft: round(frame.mouthSmileLeft ?? 0, 4),
        mouthSmileRight: round(frame.mouthSmileRight ?? 0, 4),
        headYawDegrees: round(frame.headYawDegrees ?? 0, 2),
      },
      color: frame.perceivedColor,
    });
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /** Échantillons du canal lumineux (voir l'en-tête du fichier) ; vide sans séquence lumineuse. */
  lightSamples(): LightSignalSample[] {
    const sequence = this.challenge.lightSequence;
    if (!sequence || sequence.length === 0) return [];
    const colored = this.frames.filter((f): f is RecordedFrame & { color: Rgb } => f.color !== undefined);
    if (colored.length === 0) return [];

    // Niveau ambiant : 10e percentile par composante (chaque composante est faible pour au moins
    // une couleur de la palette), plus robuste qu'un minimum pris sur une seule image bruitée.
    const floor = (channel: keyof Rgb) => {
      const values = colored.map((f) => f.color[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length * 0.1)];
    };
    const ambient = { r: floor("r"), g: floor("g"), b: floor("b") };

    const samples: LightSignalSample[] = [];
    for (const step of sequence) {
      const shownAt = Math.max(this.challenge.issuedAt + step.atMs, this.displayStartedAt);
      const from = shownAt + LIGHT_SETTLE_MS;
      const to = this.challenge.issuedAt + step.atMs + LIGHT_MEASURE_END_MS;
      const inWindow = colored.filter((f) => f.serverTimestamp >= from && f.serverTimestamp <= to);
      if (inWindow.length === 0) continue;
      const mean = (channel: keyof Rgb) => inWindow.reduce((sum, f) => sum + f.color[channel], 0) / inWindow.length;
      const delta = { r: Math.max(0, mean("r") - ambient.r), g: Math.max(0, mean("g") - ambient.g), b: Math.max(0, mean("b") - ambient.b) };
      const peak = Math.max(delta.r, delta.g, delta.b);
      samples.push({
        timestamp: Math.round(inWindow.reduce((sum, f) => sum + f.serverTimestamp, 0) / inWindow.length),
        perceivedColor: peak > 0 ? { r: round(delta.r / peak, 4), g: round(delta.g / peak, 4), b: round(delta.b / peak, 4) } : { r: 0, g: 0, b: 0 },
      });
    }
    return samples;
  }

  /** Réponse à envoyer au serveur et sa vérification locale (`serverNow` : heure serveur). */
  finish(serverNow: number): ActiveLivenessOutcome {
    const anchors = new Set(this.frames.map((f) => f.anchorId).filter((id): id is string => Boolean(id)));
    const samples = chainFrames(
      this.challenge,
      this.frames.map((f) => f.signal),
    );
    const lightSamples = this.challenge.lightSequence?.length ? this.lightSamples() : undefined;
    const submission: ActiveLivenessSubmission = { challenge: this.challenge, signature: this.signature, samples, lightSamples };
    const check = verifyLivenessResponse(this.challenge, { samples, lightSamples }, { now: serverNow });
    return {
      submission,
      check,
      anchorId: anchors.size === 1 ? [...anchors][0] : null,
      trackingInterrupted: anchors.size > 1,
    };
  }
}

/** Visage de face et au repos : le moment de prendre le selfie comparé à la photo de la puce. */
export function isNeutralFrontal(frame: ArkitLivenessFrame): boolean {
  return (
    frame.tracked &&
    Math.abs(frame.headYawDegrees ?? 90) < 12 &&
    Math.max(frame.eyeBlinkLeft ?? 1, frame.eyeBlinkRight ?? 1) < 0.4 &&
    (frame.jawOpen ?? 1) < 0.3 &&
    Math.max(frame.mouthSmileLeft ?? 1, frame.mouthSmileRight ?? 1) < 0.6
  );
}

/** Raisons d'échec du défi (codes de verify.ts) en une ligne lisible. */
export function describeLivenessFailure(check: LivenessVerificationResult, lang: "fr" | "en"): string {
  const actionName: Record<LivenessActionType, [string, string]> = {
    blink: ["clignement", "blink"],
    turn_head_left: ["tête à gauche", "head left"],
    turn_head_right: ["tête à droite", "head right"],
    open_mouth: ["bouche ouverte", "mouth open"],
    smile: ["sourire", "smile"],
  };
  const i = lang === "fr" ? 0 : 1;
  const missed = check.steps.filter((s) => !s.satisfied).map((s) => actionName[s.action][i]);
  const parts: string[] = [];
  if (missed.length > 0) parts.push((lang === "fr" ? "Non détecté : " : "Not detected: ") + missed.join(", "));
  if (check.reasons.includes("challenge_expired")) parts.push(lang === "fr" ? "défi expiré" : "challenge expired");
  if (check.lightChallengePassed === false) parts.push(lang === "fr" ? "reflet des couleurs de l'écran non mesuré" : "screen colour reflection not measured");
  return parts.join(" · ") || (lang === "fr" ? "Réponse non conforme" : "Response rejected");
}

/** Échec pour une autre raison que le seul canal lumineux (non calibré sur appareil) ? */
export function failedBeyondLight(check: LivenessVerificationResult): boolean {
  if (check.passed) return false;
  return check.steps.some((s) => !s.satisfied) || check.reasons.some((r) => !r.startsWith("light_challenge:"));
}
