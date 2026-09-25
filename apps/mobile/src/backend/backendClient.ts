import * as FileSystem from "expo-file-system";
import {
  sha256Hex,
  base64ToBytes,
  verifyJsonPayloadSignatureWithSpki,
  type LightSignalSample,
  type LivenessChallenge,
  type LivenessSignalFrame,
} from "@emrtd-verify/emrtd-core";
import type { DocumentType, VerificationResult } from "@emrtd-verify/shared-types";
import { appConfig } from "../config";

/**
 * Connexion de l'app au serveur de vérification (apps/api) — mode « En ligne · KYC ».
 *
 * Réglée depuis l'app (URL + clé API du client KYC) plutôt que seulement à la compilation
 * (config.ts). Les deux clés publiques du serveur — celle qui signe les résultats de vérification
 * et celle qui signe le bundle CSCA — sont ÉPINGLÉES après confirmation explicite de leur empreinte
 * par l'opérateur, puis ne changent plus sans nouvelle confirmation : un résultat ou un bundle signé
 * par une autre clé est refusé. Sans épinglage, rien n'est envoyé.
 */

export interface BackendSettings {
  apiBaseUrl: string;
  apiKey: string;
  /** Clé publique (SPKI base64, ECDSA P-256) qui signe `VerificationResult.signature`. */
  resultSigningKeySpkiBase64?: string;
  /** Clé publique (SPKI base64) qui signe le bundle CSCA (GET /v1/pki-trust/csca-bundle). */
  cscaBundleSigningKeySpkiBase64?: string;
  pinnedAt?: string;
}

const SETTINGS_FILE = "backend-settings.json";

function settingsUri(): string | undefined {
  return FileSystem.documentDirectory ? FileSystem.documentDirectory + SETTINGS_FILE : undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Réglages enregistrés dans l'app, sinon ceux compilés (config.ts) s'ils sont renseignés. */
export async function loadBackendSettings(): Promise<BackendSettings | null> {
  const uri = settingsUri();
  if (uri) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) return JSON.parse(await FileSystem.readAsStringAsync(uri)) as BackendSettings;
    } catch {
      // Fichier illisible : on retombe sur la configuration compilée.
    }
  }
  if (appConfig.apiKey && !appConfig.apiBaseUrl.includes(".invalid")) {
    return {
      apiBaseUrl: appConfig.apiBaseUrl,
      apiKey: appConfig.apiKey,
      cscaBundleSigningKeySpkiBase64: appConfig.cscaBundleSigningPublicKeyBase64 || undefined,
    };
  }
  return null;
}

export async function saveBackendSettings(settings: BackendSettings): Promise<void> {
  const uri = settingsUri();
  if (!uri) throw new Error("Stockage local indisponible");
  await FileSystem.writeAsStringAsync(uri, JSON.stringify({ ...settings, apiBaseUrl: normalizeBaseUrl(settings.apiBaseUrl) }));
}

export async function clearBackendSettings(): Promise<void> {
  const uri = settingsUri();
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Prêt à envoyer : URL, clé API et clé de signature des résultats épinglée. */
export function isBackendReady(settings: BackendSettings | null): settings is BackendSettings & { resultSigningKeySpkiBase64: string } {
  return Boolean(settings?.apiBaseUrl && settings.apiKey && settings.resultSigningKeySpkiBase64);
}

/** Empreinte lisible d'une clé publique : SHA-256 du SPKI, 16 premiers octets, groupés par 2. */
export function keyFingerprint(spkiBase64: string): string {
  return (sha256Hex(base64ToBytes(spkiBase64)).slice(0, 32).toUpperCase().match(/..../g) ?? []).join(" ");
}

type FetchLike = typeof fetch;

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ConnectionCheck {
  reachable: boolean;
  apiKeyAccepted: boolean;
  resultSigningKeySpkiBase64?: string;
  cscaBundleSigningKeySpkiBase64?: string;
  error?: string;
}

/**
 * Teste l'URL (GET /health), la clé API (GET /v1/verifications/signing-key, route authentifiée)
 * et récupère les clés publiques à faire confirmer par l'opérateur avant épinglage.
 */
export async function checkConnection(apiBaseUrl: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<ConnectionCheck> {
  const base = normalizeBaseUrl(apiBaseUrl);
  try {
    const health = await fetchWithTimeout(fetchImpl, `${base}/health`);
    if (!health.ok) return { reachable: false, apiKeyAccepted: false, error: `GET /health : HTTP ${health.status}` };
  } catch (error) {
    return { reachable: false, apiKeyAccepted: false, error: `Serveur injoignable : ${error instanceof Error ? error.message : String(error)}` };
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  let publicKeySpkiBase64: string | null;
  try {
    const signing = await fetchWithTimeout(fetchImpl, `${base}/v1/verifications/signing-key`, { headers });
    if (signing.status === 401 || signing.status === 403) return { reachable: true, apiKeyAccepted: false, error: "Clé API refusée" };
    if (!signing.ok) return { reachable: true, apiKeyAccepted: false, error: `Clé de signature : HTTP ${signing.status}` };
    ({ publicKeySpkiBase64 } = (await signing.json()) as { publicKeySpkiBase64: string | null });
  } catch (error) {
    return { reachable: true, apiKeyAccepted: false, error: `Clé de signature : ${error instanceof Error ? error.message : String(error)}` };
  }
  let bundleKey: string | undefined;
  try {
    const bundle = await fetchWithTimeout(fetchImpl, `${base}/v1/pki-trust/csca-bundle/signing-key`, { headers });
    if (bundle.ok) bundleKey = ((await bundle.json()) as { publicKeySpkiBase64?: string | null }).publicKeySpkiBase64 ?? undefined;
  } catch {
    bundleKey = undefined; // Facultatif : sans elle, l'app garde son magasin CSCA embarqué.
  }
  return {
    reachable: true,
    apiKeyAccepted: true,
    resultSigningKeySpkiBase64: publicKeySpkiBase64 ?? undefined,
    cscaBundleSigningKeySpkiBase64: bundleKey,
    error: publicKeySpkiBase64 ? undefined : "Le serveur ne signe pas ses résultats (VERIFICATION_RESULT_SIGNING_PRIVATE_KEY absente)",
  };
}

export interface ServerSubmission {
  documentType: DocumentType;
  /** `encodeChipDataEnvelope` (emrtd-core). */
  chipDataBase64: string;
  /** Selfie (JPEG base64) pour la comparaison faciale côté serveur. */
  liveCaptureBase64?: string;
  requestedFields?: string[];
  /** Réponse au défi de vivacité active (src/liveness/activeLiveness.ts), vérifiée par le serveur. */
  activeLiveness?: ActiveLivenessSubmission;
}

/** `SubmitVerificationDto.activeLiveness` : le challenge et sa signature renvoyés tels quels. */
export interface ActiveLivenessSubmission {
  challenge: LivenessChallenge;
  signature: string;
  samples: LivenessSignalFrame[];
  lightSamples?: LightSignalSample[];
}

export interface IssuedLivenessChallenge {
  challenge: LivenessChallenge;
  signature: string;
  /** Heure locale (Date.now) à l'envoi de la requête et à la réception du challenge. */
  sentAt: number;
  receivedAt: number;
}

/**
 * Défi de vivacité active émis et signé par le serveur (POST /v1/verifications/liveness-challenge),
 * à demander juste avant l'exécuter : ses fenêtres d'action sont comptées depuis son émission.
 */
export async function requestLivenessChallenge(
  settings: BackendSettings,
  fetchImpl: FetchLike = fetch,
): Promise<IssuedLivenessChallenge> {
  const sentAt = Date.now();
  const response = await fetchWithTimeout(fetchImpl, `${normalizeBaseUrl(settings.apiBaseUrl)}/v1/verifications/liveness-challenge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    timeoutMs: 5000,
  });
  const receivedAt = Date.now();
  if (!response.ok) throw new Error(`Défi de vivacité : HTTP ${response.status}`);
  const body = (await response.json()) as { challenge?: LivenessChallenge; signature?: string };
  if (!body.challenge || typeof body.signature !== "string" || !Array.isArray(body.challenge.steps)) {
    throw new Error("Défi de vivacité : réponse inattendue");
  }
  return { challenge: body.challenge, signature: body.signature, sentAt, receivedAt };
}

export type ServerOutcome =
  | { kind: "result"; result: VerificationResult; signatureValid: boolean; verificationId: string }
  | { kind: "pending"; verificationId: string }
  | { kind: "failed"; error: string };

/**
 * Envoie la vérification (POST /v1/verifications) puis attend le résultat signé (GET, traitement
 * asynchrone côté serveur) jusqu'à `timeoutMs`. La signature est toujours vérifiée contre la clé
 * épinglée : un résultat non signé ou mal signé est rendu avec `signatureValid: false`, jamais
 * présenté comme faisant foi.
 */
export async function submitAndAwaitResult(
  settings: BackendSettings & { resultSigningKeySpkiBase64: string },
  submission: ServerSubmission,
  options: { timeoutMs?: number; pollMs?: number; fetchImpl?: FetchLike } = {},
): Promise<ServerOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = normalizeBaseUrl(settings.apiBaseUrl);
  const headers = { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" };
  let verificationId: string;
  try {
    const response = await fetchWithTimeout(fetchImpl, `${base}/v1/verifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        documentType: submission.documentType,
        chipData: submission.chipDataBase64,
        liveCapture: submission.liveCaptureBase64,
        requestedFields: submission.requestedFields,
        activeLiveness: submission.activeLiveness,
      }),
      timeoutMs: 15000,
    });
    if (!response.ok) return { kind: "failed", error: `Envoi refusé : HTTP ${response.status}` };
    verificationId = ((await response.json()) as { verificationId: string }).verificationId;
  } catch (error) {
    return { kind: "failed", error: `Envoi impossible : ${error instanceof Error ? error.message : String(error)}` };
  }

  const deadline = Date.now() + (options.timeoutMs ?? 30000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 1500));
    try {
      const response = await fetchWithTimeout(fetchImpl, `${base}/v1/verifications/${verificationId}`, { headers });
      if (response.status === 404) continue; // pas encore traité
      if (!response.ok) return { kind: "failed", error: `Résultat : HTTP ${response.status}` };
      const result = (await response.json()) as VerificationResult;
      return { kind: "result", result, signatureValid: await verifyResultSignature(result, settings.resultSigningKeySpkiBase64), verificationId };
    } catch {
      // Coupure passagère : on réessaie jusqu'à l'échéance.
    }
  }
  return { kind: "pending", verificationId };
}

export async function verifyResultSignature(result: VerificationResult, spkiBase64: string): Promise<boolean> {
  if (!result.signature) return false;
  const { signature, ...unsigned } = result;
  // JavaScript pur : Hermes n'a pas Web Crypto (voir emrtd-core jsonSigning.ts).
  return verifyJsonPayloadSignatureWithSpki(unsigned, signature, spkiBase64);
}
