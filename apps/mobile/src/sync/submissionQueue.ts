import * as FileSystem from "expo-file-system";
import type { LivenessChallenge, LivenessSignalFrame, LightSignalSample } from "@emrtd-verify/emrtd-core";
import type { DocumentType, VerificationResult } from "@emrtd-verify/shared-types";
import type { LocalVerificationResult } from "../verification/localVerification";
import { loadBackendSettings, verifyResultSignature, type BackendSettings } from "../backend/backendClient";

const QUEUE_FILE_NAME = "submission-queue.json";
const MAX_ATTEMPTS_BEFORE_LONG_BACKOFF = 5;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface QueuedActiveLiveness {
  challenge: LivenessChallenge;
  signature: string;
  samples: LivenessSignalFrame[];
  lightSamples?: LightSignalSample[];
}

export interface QueuedDeviceAttestation {
  platform: "ios" | "android";
  attestationToken: string;
  expectedNonce: string;
}

export type QueuedSubmissionStatus = "pending" | "submitted" | "reconciled" | "failed";

/**
 * Une vérification en attente de transmission/réconciliation avec apps/api — voir
 * docs/pki-trust-model.md "Vérification hors ligne". `localResult` (voir
 * verification/localVerification.ts) reste marqué `provisional: true` jusqu'à ce que
 * `reconciledResult` (le `VerificationResult` signé, produit par le serveur) soit obtenu :
 * exigence PVID — ni revue humaine, ni piste d'audit centralisée ne peuvent exister sur
 * l'appareil seul, voir la documentation de `computeLocalVerification`.
 */
export interface QueuedSubmission {
  id: string;
  createdAt: string;
  documentType: DocumentType;
  /** Format `chipData` (base64 de JSON) attendu par `SubmitVerificationDto.chipData` — voir @emrtd-verify/emrtd-core `encodeChipDataEnvelope`. */
  chipDataBase64: string;
  liveCaptureBase64?: string;
  requestedFields?: string[];
  activeLiveness?: QueuedActiveLiveness;
  deviceAttestation?: QueuedDeviceAttestation;
  localResult: LocalVerificationResult;
  status: QueuedSubmissionStatus;
  verificationId?: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  reconciledResult?: VerificationResult;
  /** Signature du résultat vérifiée contre la clé épinglée (Réglages › Serveur KYC) ; false si absente ou non épinglée. */
  reconciledSignatureValid?: boolean;
}

function queueFileUri(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    throw new Error("documentDirectory indisponible sur cette plateforme");
  }
  return dir + QUEUE_FILE_NAME;
}

async function readQueue(): Promise<QueuedSubmission[]> {
  const uri = queueFileUri();
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    return [];
  }
  const content = await FileSystem.readAsStringAsync(uri);
  return JSON.parse(content) as QueuedSubmission[];
}

async function writeQueue(queue: QueuedSubmission[]): Promise<void> {
  await FileSystem.writeAsStringAsync(queueFileUri(), JSON.stringify(queue));
}

function generateLocalId(): string {
  // Identifiant purement local (jamais transmis tel quel, sert uniquement à retrouver l'élément
  // dans la file) — pas besoin d'un UUID cryptographiquement fort ici, contrairement au nonce de
  // challenge de liveness (voir liveness/challenge.ts, signé côté serveur).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `verificationId` : soumission déjà acceptée par le serveur (mode en ligne) dont le résultat
 * n'était pas prêt à temps — elle entre en file directement à l'état `submitted`, pour être
 * seulement réconciliée (jamais renvoyée, ce qui créerait une seconde vérification).
 */
export async function enqueueSubmission(
  input: Omit<QueuedSubmission, "id" | "createdAt" | "status" | "attempts" | "verificationId" | "lastAttemptAt" | "lastError" | "reconciledResult" | "reconciledSignatureValid">,
  options: { verificationId?: string; lastError?: string } = {},
): Promise<QueuedSubmission> {
  const item: QueuedSubmission = {
    ...input,
    id: generateLocalId(),
    createdAt: new Date().toISOString(),
    status: options.verificationId ? "submitted" : "pending",
    verificationId: options.verificationId,
    lastError: options.lastError,
    attempts: 0,
  };
  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
  return item;
}

export async function getQueuedSubmissions(): Promise<QueuedSubmission[]> {
  return readQueue();
}

/** Backoff exponentiel plafonné — évite de marteler le réseau pendant une coupure prolongée. */
function nextAttemptDueAt(item: QueuedSubmission): number {
  if (!item.lastAttemptAt) return 0;
  const backoff = Math.min(BASE_BACKOFF_MS * 2 ** Math.min(item.attempts, MAX_ATTEMPTS_BEFORE_LONG_BACKOFF), MAX_BACKOFF_MS);
  return new Date(item.lastAttemptAt).getTime() + backoff;
}

function buildSubmitBody(item: QueuedSubmission) {
  return {
    documentType: item.documentType,
    chipData: item.chipDataBase64,
    liveCapture: item.liveCaptureBase64,
    requestedFields: item.requestedFields,
    activeLiveness: item.activeLiveness,
    deviceAttestation: item.deviceAttestation,
  };
}

/**
 * Tente de transmettre chaque soumission encore `pending` à `POST /v1/verifications` — jamais
 * bloquant : une erreur réseau sur un élément n'empêche pas de tenter les suivants, et l'élément
 * reste en file pour un prochain cycle (voir `nextAttemptDueAt`). Ne remplace JAMAIS
 * `localResult` : seul `reconciledResult` (voir `reconcileSubmittedResults`) fait foi.
 */
export async function submitPendingSubmissions(): Promise<{ attempted: number; succeeded: number }> {
  const settings = await loadBackendSettings();
  if (!settings) return { attempted: 0, succeeded: 0 }; // aucun serveur configuré : tout reste en file
  const queue = await readQueue();
  const now = Date.now();
  let attempted = 0;
  let succeeded = 0;

  for (const item of queue) {
    if (item.status !== "pending") continue;
    if (now < nextAttemptDueAt(item)) continue;
    attempted++;

    item.attempts++;
    item.lastAttemptAt = new Date().toISOString();
    try {
      const response = await fetch(`${settings.apiBaseUrl}/v1/verifications`, {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmitBody(item)),
      });
      if (!response.ok) {
        item.lastError = `HTTP ${response.status}`;
        continue;
      }
      const body = (await response.json()) as { verificationId: string };
      item.verificationId = body.verificationId;
      item.status = "submitted";
      item.lastError = undefined;
      succeeded++;
    } catch (error) {
      // Panne réseau (hors ligne) — attendu et normal, pas une erreur applicative : l'élément
      // reste `pending` pour le prochain cycle (voir nextAttemptDueAt pour le backoff).
      item.lastError = String(error);
    }
  }

  await writeQueue(queue);
  return { attempted, succeeded };
}

/**
 * Récupère le `VerificationResult` signé pour chaque soumission déjà transmise (`submitted`) mais
 * pas encore réconciliée — le traitement serveur est asynchrone (file BullMQ, voir
 * VerificationProcessor), donc un 404 immédiatement après soumission est normal (pas encore
 * traité) et n'est PAS une erreur : l'élément reste `submitted` pour le prochain cycle.
 */
export async function reconcileSubmittedResults(): Promise<{ attempted: number; reconciled: number }> {
  const settings = await loadBackendSettings();
  if (!settings) return { attempted: 0, reconciled: 0 };
  const queue = await readQueue();
  let attempted = 0;
  let reconciled = 0;

  for (const item of queue) {
    if (item.status !== "submitted" || !item.verificationId) continue;
    attempted++;
    try {
      const response = await fetch(`${settings.apiBaseUrl}/v1/verifications/${item.verificationId}`, {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
      });
      if (response.status === 404) {
        continue; // pas encore traité côté serveur — normal, on réessaiera
      }
      if (!response.ok) {
        item.lastError = `HTTP ${response.status}`;
        continue;
      }
      const result = (await response.json()) as VerificationResult;
      item.reconciledResult = result;
      item.reconciledSignatureValid = await resultSignatureValid(result, settings);
      item.status = "reconciled";
      item.lastError = undefined;
      reconciled++;
    } catch (error) {
      item.lastError = String(error);
    }
  }

  await writeQueue(queue);
  return { attempted, reconciled };
}

async function resultSignatureValid(result: VerificationResult, settings: BackendSettings): Promise<boolean> {
  return settings.resultSigningKeySpkiBase64 ? verifyResultSignature(result, settings.resultSigningKeySpkiBase64) : false;
}

/** Enchaîne soumission puis réconciliation — à appeler périodiquement (retour au premier plan, reconnexion réseau, minuteur applicatif). */
export async function runSyncCycle(): Promise<{ submitted: number; reconciled: number }> {
  const { succeeded } = await submitPendingSubmissions();
  const { reconciled } = await reconcileSubmittedResults();
  return { submitted: succeeded, reconciled };
}

/** Purge les soumissions déjà réconciliées plus anciennes que `olderThanMs` — la vérité durable est côté serveur, pas la file locale. */
export async function pruneReconciled(olderThanMs: number = 30 * 24 * 3600_000): Promise<number> {
  const queue = await readQueue();
  const cutoff = Date.now() - olderThanMs;
  const kept = queue.filter((item) => !(item.status === "reconciled" && new Date(item.createdAt).getTime() < cutoff));
  await writeQueue(kept);
  return queue.length - kept.length;
}
