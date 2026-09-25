/**
 * Machine à états et valeurs dérivées.
 *
 * Deux modes coexistent :
 * - MODE DÉMO (inchangé) : `scenario`/`lang` restent des commutateurs de démonstration pilotant
 *   la logique transcrite depuis la `class Component extends DCLogic` du prototype HTML
 *   (`design_handoff_authentik/eMRTD Verify Mobile.dc.html`, méthodes `startScan`/`runNfc`/
 *   `runSelfie`/`renderVals`) — utile pour prévisualiser les trois verdicts sans document réel.
 * - MODE RÉEL (nouveau) : `startScan` mène à un vrai formulaire MRZ (`mrzForm`/`updateMrzForm`/
 *   `submitMrz`), puis `beginNfc` déclenche une vraie lecture NFC PACE/BAC (`readEmrtdChip`,
 *   apps/mobile/src/nfc/emrtdReader.ts) suivie d'une vraie vérification locale
 *   (`computeLocalVerification`, apps/mobile/src/verification/localVerification.ts). Dès qu'un
 *   `verificationResult` réel existe, `derived` l'utilise à la place des données canned du mode
 *   démo — voir `deriveFromRealResult` plus bas.
 *
 * Après la lecture NFC, si la puce a livré la photo (DG2) et que la comparaison faciale est activée
 * (Réglages), l'étape "selfie" filme le porteur (modules/face-kit, séquence de vivacité guidée de
 * src/faceMatch/selfieLiveness.ts) avant la vérification locale, qui compare alors le selfie à la
 * photo de la puce (src/faceMatch).
 *
 * MODE EN LIGNE · KYC (serveur réglé dans Réglages › Serveur KYC, clé de signature épinglée —
 * src/backend/backendClient.ts) : après la vérification locale, la puce lue et le selfie (JPEG)
 * sont envoyés au serveur (POST /v1/verifications) et son résultat signé est attendu ~30 s. Signé
 * par la clé épinglée, il fait foi (verdict, registre perdus/volés, révocation côté serveur) ; sinon
 * le verdict local provisoire reste affiché et la soumission part dans la file d'attente
 * (src/sync/submissionQueue.ts), réconciliée au prochain cycle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NfcError } from "react-native-nfc-manager";
import type { AnomalySeverity, DocumentType, Verdict, VerificationResult } from "@emrtd-verify/shared-types";
import { copyFor, type Lang } from "./copy";
import { paletteFor, type ColorScheme, type PaletteColors } from "./theme";
import { feedback, type FeedbackKind } from "./feedback";
import {
  readEmrtdChip,
  NfcUnavailableError,
  BacAuthenticationError,
  ChipReaderError,
  PaceAuthenticationError,
  PaceError,
  type EmrtdReadResult,
  type MrzAccessKey,
} from "../nfc/emrtdReader";
import { computeLocalVerification, dg14AnnouncesChipAuthentication, LocalVerificationError, type LocalVerificationResult } from "../verification/localVerification";
import { embeddedCountryRows, embeddedStoreRows, fillStoreStats } from "./trustStoreSummary";
import { bytesToBase64, extractDg2FaceImage } from "@emrtd-verify/emrtd-core";
import { FaceKit } from "../../modules/face-kit";
import { faceSampleFromCrop, type NativeFaceCrop } from "../faceMatch/faceCrop";
import { getSfaceSession } from "../faceMatch/sfaceModel";
import { refreshRevocationLists, revocationListsFor } from "../pki/crlCache";
import { SfaceTensor } from "../faceMatch/sfaceSession";
import { encodeChipDataEnvelope } from "@emrtd-verify/emrtd-core";
import {
  isBackendReady,
  loadBackendSettings,
  submitAndAwaitResult,
  type ActiveLivenessSubmission,
  type BackendSettings,
  type ServerOutcome,
  type ServerSubmission,
} from "../backend/backendClient";
import { enqueueSubmission, runSyncCycle } from "../sync/submissionQueue";
import { syncCscaBundle } from "../pki/cscaBundleSync";

/** Carte d'identité affichée sur le verdict (format "pièce d'identité"). */
export interface IdCardView {
  countryCode: string;
  docTypeLabel: string;
  surname: string;
  givenNames: string;
  birthDate: string;
  sex: string;
  nationality: string;
  documentNumber: string;
  expiryDate: string;
}

/** "1985-03-14" → "14/03/1985" (dates ISO produites par le parseur MRZ). */
function isoToDisplayDate(iso: string | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
}

export type Scenario = "authentic" | "suspicious" | "alert";
export type Step =
  | "home"
  | "mrz"
  | "place"
  | "nfc"
  | "selfie"
  | "processing"
  | "verdict"
  | "fields"
  | "chain"
  | "anomalies"
  | "trust"
  | "countries"
  | "country"
  | "settings"
  | "server";

/** Transition d'entrée de l'écran — table `ANIM` du design v2 (voir components/ScreenTransition.tsx). */
export type ScreenAnim = "push" | "back" | "modal" | "fade" | "tab" | "verdict" | "none";

const TAB_STEPS: Step[] = ["home", "trust", "countries", "country", "settings", "server"];

const OK = "#30D158";
const WARN = "#FF9F0A";
const INFO = "#8E8E93";

const DG_LABELS: Record<number, string> = {
  1: "MRZ",
  2: "Photo",
  14: "ChipAuth",
  15: "ActiveAuth",
};

type ScanErrorAction = "enable-nfc" | "rescan-mrz" | "retry-nfc";

interface VerificationError {
  message: string;
  action: ScanErrorAction;
}

function describeVerificationError(error: unknown): VerificationError {
  if (error instanceof NfcUnavailableError) {
    return { message: "NFC indisponible : vérifiez qu'il est activé dans les réglages de l'appareil.", action: "enable-nfc" };
  }
  if (error instanceof BacAuthenticationError || error instanceof PaceAuthenticationError) {
    return {
      message: "Impossible d'établir un canal sécurisé avec le document : les informations saisies sont peut-être incorrectes.",
      action: "rescan-mrz",
    };
  }
  if (error instanceof PaceError) {
    return { message: "La connexion sécurisée (PACE) avec la puce a échoué : maintenez le document immobile et réessayez.", action: "retry-nfc" };
  }
  if (error instanceof ChipReaderError) {
    return { message: "La lecture de la puce a échoué en cours de session (transmission interrompue).", action: "retry-nfc" };
  }
  if (error instanceof LocalVerificationError) {
    return { message: "Le contenu lu sur la puce n'a pas pu être décodé (document non conforme ou lecture incomplète).", action: "retry-nfc" };
  }
  if (error instanceof NfcError.UserCancel) {
    return { message: "Lecture annulée.", action: "retry-nfc" };
  }
  if (error instanceof NfcError.SessionInvalidated || error instanceof NfcError.TagConnectionLost || error instanceof NfcError.Timeout) {
    return { message: "Session NFC interrompue : rapprochez le document du téléphone et réessayez.", action: "retry-nfc" };
  }
  return { message: error instanceof Error ? error.message : "Erreur inconnue", action: "retry-nfc" };
}

export interface MrzFormState {
  documentType: DocumentType;
  documentNumber: string;
  // AAMMJJ — rempli soit par la saisie manuelle, soit par la capture caméra + OCR (voir
  // authentik/components/MrzCameraScanner.tsx, ../../mrz/mrzFromLines.ts) ; identique dans les deux cas.
  dateOfBirth: string;
  dateOfExpiry: string; // AAMMJJ
}

const DEFAULT_MRZ_FORM: MrzFormState = {
  documentType: "ePassport",
  documentNumber: "",
  dateOfBirth: "",
  dateOfExpiry: "",
};

interface RawState {
  step: Step;
  anim: ScreenAnim;
  feedbackOn: boolean;
  /** Contrôles exigés (Réglages) — désactivés par défaut : ni CRL ni registre perdu/volé ne sont joignables hors ligne. */
  requireRevocationCheck: boolean;
  requireLostStolenCheck: boolean;
  langSel: Lang | null;
  scenarioSel: Scenario | null;
  pct: number;
  showShare: boolean;
  livePhase: number;
  online: boolean;
  scheme: ColorScheme;
  mrzForm: MrzFormState;
  verificationStatus: "idle" | "reading-nfc" | "verifying";
  verificationError: VerificationError | null;
  chipResult: EmrtdReadResult | null;
  verificationResult: LocalVerificationResult | null;
  /** Pays dont la fiche CSCA est ouverte (étape "country"). */
  selectedCountry: string | null;
  /** Réglages : selfie + comparaison à la photo de la puce après la lecture NFC (iOS). */
  faceMatchEnabled: boolean;
  /** Pourquoi la comparaison faciale n'a pas eu lieu, le cas échéant (affiché sur le verdict). */
  faceMatchNote: string | null;
  /** Vivacité active : pourquoi elle n'a pas eu lieu, le cas échéant (affiché sur le verdict). */
  livenessNote: string | null;
  /** Serveur KYC réglé dans l'app (Réglages › Serveur KYC), `null` si aucun. */
  backend: BackendSettings | null;
  /** Vérification serveur de la dernière lecture (mode en ligne seulement). */
  server: ServerState | null;
}

export type ServerState = { phase: "sending" } | { phase: "done"; outcome: ServerOutcome; queued: boolean };

export function useAuthentikDemo() {
  const [s, setS] = useState<RawState>({
    step: "home",
    anim: "none",
    feedbackOn: true,
    requireRevocationCheck: false,
    requireLostStolenCheck: false,
    langSel: null,
    scenarioSel: null,
    pct: 0,
    showShare: false,
    livePhase: 0,
    online: false,
    // Sombre par défaut (design v2) ; le mode clair reste accessible depuis les Réglages.
    scheme: "dark",
    mrzForm: DEFAULT_MRZ_FORM,
    verificationStatus: "idle",
    verificationError: null,
    chipResult: null,
    verificationResult: null,
    selectedCountry: null,
    faceMatchEnabled: true,
    faceMatchNote: null,
    livenessNote: null,
    backend: null,
    server: null,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef(0);
  const sRef = useRef(s);
  sRef.current = s;

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (toRef.current) {
      clearTimeout(toRef.current);
      toRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  // Serveur KYC : réglages relus au lancement ; s'il est prêt, mode en ligne par défaut, envoi de la
  // file d'attente et mise à jour du magasin CSCA signé (échecs silencieux : on reste hors ligne).
  const refreshBackend = useCallback(async () => {
    const backend = await loadBackendSettings();
    const ready = isBackendReady(backend);
    setS((prev) => ({ ...prev, backend, online: ready ? prev.online || prev.backend === null : false }));
    if (!ready) return;
    runSyncCycle().catch((error) => __DEV__ && console.log(`[SYNC] ${String(error)}`));
    if (backend?.cscaBundleSigningKeySpkiBase64) {
      syncCscaBundle().catch((error) => __DEV__ && console.log(`[CSCA] ${String(error)}`));
    }
  }, []);
  useEffect(() => {
    void refreshBackend();
  }, [refreshBackend]);

  const go = useCallback(
    (step: Step, anim: ScreenAnim = "push") => {
      clear();
      setS((prev) => ({ ...prev, step, anim, showShare: false }));
    },
    [clear],
  );

  const fb = useCallback((kind: FeedbackKind) => feedback(kind, sRef.current.feedbackOn), []);

  const scenario = useCallback((): Scenario => sRef.current.scenarioSel ?? "suspicious", []);

  // Mode démo : verdict du scénario choisi (design v2, `toVerdict`).
  const toVerdict = useCallback(() => {
    const sc = scenario();
    setS((prev) => ({ ...prev, step: "verdict", anim: "verdict" }));
    fb(sc === "alert" ? "error" : sc === "suspicious" ? "warning" : "success");
  }, [scenario, fb]);

  const toProcessing = useCallback(() => {
    setS((prev) => ({ ...prev, step: "processing", anim: "fade" }));
    toRef.current = setTimeout(toVerdict, 1700);
  }, [toVerdict]);

  // Mode démo uniquement. Le mode réel ne passe jamais par "selfie" (voir en-tête).
  const runSelfie = useCallback(() => {
    const scNow = scenario();
    const face = scNow === "suspicious" || scNow === "alert";
    if (!face) {
      toProcessing();
      return;
    }
    setS((prev) => ({ ...prev, step: "selfie", livePhase: 0, anim: "fade" }));
    tickRef.current = 0;
    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const n = Math.min(3, tickRef.current);
      setS((prev) => ({ ...prev, livePhase: n }));
      fb(n >= 3 ? "live" : "tick");
      if (n >= 3) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        toRef.current = setTimeout(toProcessing, 1500);
      }
    }, 1400);
  }, [scenario, toProcessing, fb]);

  // Mode démo uniquement (minuteurs canned).
  const runNfcDemo = useCallback(() => {
    setS((prev) => ({ ...prev, step: "nfc", pct: 0, anim: "push" }));
    tickRef.current = 0;
    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const p = Math.min(100, tickRef.current * 25);
      setS((prev) => ({ ...prev, pct: p }));
      fb(p >= 100 ? "live" : "tick");
      if (p >= 100) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        toRef.current = setTimeout(() => runSelfie(), 550);
      }
    }, 700);
  }, [runSelfie, fb]);

  const startScan = useCallback(() => {
    clear();
    fb("tap");
    setS((prev) => ({ ...prev, step: "mrz", anim: "modal", pct: 0, showShare: false, verificationError: null }));
  }, [clear, fb]);

  const updateMrzForm = useCallback((patch: Partial<MrzFormState>) => {
    setS((prev) => ({ ...prev, mrzForm: { ...prev.mrzForm, ...patch } }));
  }, []);

  const mrzFormValid = useMemo(() => {
    const f = s.mrzForm;
    return f.documentNumber.trim().length > 0 && /^\d{6}$/.test(f.dateOfBirth) && /^\d{6}$/.test(f.dateOfExpiry);
  }, [s.mrzForm]);

  const submitMrz = useCallback(() => {
    const f = sRef.current.mrzForm;
    const valid = f.documentNumber.trim().length > 0 && /^\d{6}$/.test(f.dateOfBirth) && /^\d{6}$/.test(f.dateOfExpiry);
    if (!valid) return;
    fb("tick");
    setS((prev) => ({ ...prev, step: "place", anim: "push" }));
  }, [fb]);

  // Vérification locale (computeLocalVerification), avec la comparaison faciale si un selfie a
  // été capturé : visage de la photo DG2 (JPEG / JPEG 2000) trouvé par modules/face-kit, puis
  // embeddings SFace (onnxruntime) comparés — voir src/faceMatch/faceMatch.ts.
  const verifyChip = useCallback(async (chipResult: EmrtdReadResult, selfie: NativeFaceCrop | null, skippedNote: string | null, liveness?: SelfieLiveness) => {
    const { mrzForm, online, backend } = sRef.current;
    const sendToServer = online && isBackendReady(backend);
    setS((prev) => ({
      ...prev,
      pct: 100,
      chipResult,
      step: "processing",
      anim: "fade",
      verificationStatus: "verifying",
      faceMatchNote: skippedNote,
      livenessNote: liveness?.note ?? null,
      server: sendToServer ? { phase: "sending" } : null,
    }));

    // Envoi au serveur tout de suite, en parallèle de la vérification locale : le défi de vivacité
    // active expire ~15 s après sa dernière action (challenge.ts), le serveur doit l'avoir reçu avant.
    const submission = sendToServer ? buildServerSubmission(mrzForm.documentType, chipResult, selfie, liveness?.active?.submission) : null;
    const serverOutcome = submission && isBackendReady(backend) ? submitAndAwaitResult(backend, submission) : null;

    let faceMatch: Parameters<typeof computeLocalVerification>[0]["faceMatch"];
    let faceMatchNote = skippedNote;
    if (selfie && FaceKit) {
      try {
        const portrait = extractDg2FaceImage(chipResult.dataGroups[2]);
        const reference = faceSampleFromCrop(await FaceKit.detectFaceInImage(bytesToBase64(portrait.imageBytes)));
        const probe = faceSampleFromCrop(selfie);
        faceMatch = {
          session: await getSfaceSession(),
          tensorConstructor: SfaceTensor,
          input: {
            referenceImage: reference.image,
            referenceFace: reference.face,
            probeImage: probe.image,
            probeFace: probe.face,
            probeFaceCount: probe.faceCount,
          },
        };
      } catch (error) {
        faceMatchNote = `Comparaison impossible : ${error instanceof Error ? error.message : String(error)}`;
        if (__DEV__) console.log(`[FACE] ${faceMatchNote}`);
      }
    }

    try {
      const result = await computeLocalVerification({
        documentType: mrzForm.documentType,
        chipData: {
          sod: chipResult.sod,
          dataGroups: chipResult.dataGroups,
          activeAuthentication: chipResult.activeAuthentication?.response
            ? { challenge: chipResult.activeAuthentication.challenge, responseDer: chipResult.activeAuthentication.response }
            : undefined,
          chipAuthentication: chipResult.chipAuthentication,
        },
        faceMatch,
        activeLiveness: liveness?.active
          ? { ...liveness.active.submission, now: Date.now() + liveness.active.clockOffsetMs }
          : undefined,
        // CRL du pays : mise à jour depuis le réseau si celle en cache est absente ou périmée
        // (5 s max, sans bloquer hors ligne), puis vérification contre les CSCA — pki/crlCache.ts.
        loadRevocationLists: async (country, anchors) => {
          const refresh = await refreshRevocationLists(country, anchors, { timeoutMs: 5000 });
          if (__DEV__ && !refresh.skipped) {
            console.log(`[CRL] ${country} : ${refresh.added} CRL ajoutée(s)${refresh.failures.length ? ` ; échecs : ${refresh.failures.join(" | ")}` : ""}`);
          }
          return revocationListsFor(country, anchors);
        },
        requestedFields: REQUESTED_FIELDS,
        skippedChecks: {
          revocation: !sRef.current.requireRevocationCheck,
          lostStolen: !sRef.current.requireLostStolenCheck,
        },
      });
      if (__DEV__ && result.faceMatch) {
        console.log(`[FACE] similarité ${result.faceMatch.similarityScore.toFixed(3)} → ${result.faceMatch.matchDecision}`);
      }
      let server: ServerState | null = null;
      if (submission && serverOutcome) {
        server = await settleServerOutcome(serverOutcome, submission, result);
      }
      const signed = server?.phase === "done" && server.outcome.kind === "result" && server.outcome.signatureValid ? server.outcome.result : null;
      const verdict = signed?.verdict ?? result.verdict;
      setS((prev) => ({ ...prev, verificationResult: result, verificationStatus: "idle", step: "verdict", anim: "verdict", faceMatchNote, server }));
      fb(verdict === "rejected" ? "error" : verdict === "authentic" ? "success" : "warning");
    } catch (error) {
      if (__DEV__) console.log(`[VERIF] Échec : ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      const described = describeVerificationError(error);
      fb("error");
      setS((prev) => ({ ...prev, step: "place", anim: "back", verificationStatus: "idle", verificationError: described }));
    }
  }, [fb]);

  /**
   * Fin de l'écran selfie (mode réel) : `null` si l'utilisateur a passé l'étape ; `liveness`, la
   * réponse au défi de vivacité active (caméra TrueDepth) ou pourquoi elle manque.
   */
  const completeSelfie = useCallback(
    (capture: NativeFaceCrop | null, liveness?: SelfieLiveness) => {
      const chipResult = sRef.current.chipResult;
      if (!chipResult) return;
      fb(capture ? "live" : "tap");
      void verifyChip(chipResult, capture, capture ? null : "Selfie passé", liveness);
    },
    [fb, verifyChip],
  );

  // Mode réel : lecture NFC PACE/BAC réelle (readEmrtdChip), puis selfie (SelfieScreen →
  // completeSelfie) si la puce a livré une photo, puis vérification locale (verifyChip).
  const runVerification = useCallback(async () => {
    const { mrzForm } = sRef.current;
    const accessKey: MrzAccessKey = {
      documentNumber: mrzForm.documentNumber.trim(),
      dateOfBirth: mrzForm.dateOfBirth,
      dateOfExpiry: mrzForm.dateOfExpiry,
    };

    // Un retour au démarrage et un à la fin de la lecture ; entre les deux, la jauge suit la
    // progression réelle remontée par readEmrtdChip (canal sécurisé établi, puis chaque fichier lu).
    fb("tap");
    setS((prev) => ({ ...prev, step: "nfc", anim: "push", pct: 0, verificationStatus: "reading-nfc", verificationError: null }));

    let chipResult: EmrtdReadResult;
    try {
      chipResult = await readEmrtdChip(accessKey, {
        onProgress: (fraction) => setS((prev) => ({ ...prev, pct: Math.max(prev.pct, Math.round(fraction * 100)) })),
      });
    } catch (error) {
      clear();
      const described = describeVerificationError(error);
      fb("error");
      setS((prev) => ({
        ...prev,
        step: described.action === "rescan-mrz" ? "mrz" : "place",
        anim: "back",
        verificationStatus: "idle",
        verificationError: described,
      }));
      return;
    }
    clear();
    fb("live");
    const hasPortrait = chipResult.dataGroups[2] !== undefined;
    if (sRef.current.faceMatchEnabled && hasPortrait && FaceKit) {
      // Selfie puis comparaison à la photo DG2 : SelfieScreen appelle completeSelfie.
      setS((prev) => ({ ...prev, pct: 100, chipResult, step: "selfie", anim: "fade", verificationStatus: "idle", livePhase: 0 }));
      return;
    }
    const note = !sRef.current.faceMatchEnabled
      ? "Désactivée dans les Réglages"
      : !hasPortrait
        ? "Pas de photo (DG2) lue sur la puce"
        : "Indisponible sur cet appareil (module natif absent : recompiler l'app)";
    void verifyChip(chipResult, null, note);
  }, [clear, fb, verifyChip]);

  const beginNfc = useCallback(() => {
    clear();
    if (sRef.current.mrzForm.documentNumber.trim().length > 0) {
      void runVerification();
    } else {
      // Mode démo : aucun formulaire MRZ réel rempli (ex. démarré via le commutateur de scénario
      // plutôt que via startScan → submitMrz) — on garde le comportement canned existant.
      runNfcDemo();
    }
  }, [clear, runVerification, runNfcDemo]);

  const reset = useCallback(() => {
    clear();
    setS((prev) => ({
      ...prev,
      step: "home",
      anim: TAB_STEPS.includes(prev.step) ? "tab" : "fade",
      pct: 0,
      showShare: false,
      mrzForm: DEFAULT_MRZ_FORM,
      verificationStatus: "idle",
      verificationError: null,
      chipResult: null,
      verificationResult: null,
      faceMatchNote: null,
      livenessNote: null,
      server: null,
    }));
  }, [clear]);

  const toggleLang = useCallback(() => {
    setS((prev) => ({ ...prev, langSel: (prev.langSel ?? "fr") === "en" ? "fr" : "en" }));
  }, []);

  const toggleScenario = useCallback(() => {
    clear();
    setS((prev) => {
      const suspicious = (prev.scenarioSel ?? "suspicious") === "suspicious";
      const alert = (prev.scenarioSel ?? "suspicious") === "alert";
      const next: Scenario = suspicious ? "authentic" : alert ? "suspicious" : "alert";
      return { ...prev, scenarioSel: next, step: "home", anim: "fade", showShare: false };
    });
  }, [clear]);

  // Sans serveur prêt (URL, clé API, clé de signature épinglée), le commutateur ouvre son réglage.
  const toggleOnline = useCallback(() => {
    if (!isBackendReady(sRef.current.backend)) {
      clear();
      setS((prev) => ({ ...prev, step: "server", anim: "push", showShare: false }));
      return;
    }
    setS((prev) => ({ ...prev, online: !prev.online }));
  }, [clear]);
  const toggleScheme = useCallback(
    () => setS((prev) => ({ ...prev, scheme: prev.scheme === "dark" ? "light" : "dark" })),
    [],
  );
  const toggleFeedback = useCallback(() => setS((prev) => ({ ...prev, feedbackOn: !prev.feedbackOn })), []);
  const toggleRevocationCheck = useCallback(() => setS((prev) => ({ ...prev, requireRevocationCheck: !prev.requireRevocationCheck })), []);
  const toggleLostStolenCheck = useCallback(() => setS((prev) => ({ ...prev, requireLostStolenCheck: !prev.requireLostStolenCheck })), []);
  const toggleFaceMatch = useCallback(() => setS((prev) => ({ ...prev, faceMatchEnabled: !prev.faceMatchEnabled })), []);
  const openShare = useCallback(() => setS((prev) => ({ ...prev, showShare: true })), []);
  const closeShare = useCallback(() => setS((prev) => ({ ...prev, showShare: false })), []);

  const lang: Lang = s.langSel ?? "fr";
  const currentScenario: Scenario = s.scenarioSel ?? "suspicious";
  const paletteColors = useMemo(() => paletteFor(s.scheme), [s.scheme]);

  const derived = useMemo(() => {
    const t = copyFor(lang);

    if (s.verificationResult) {
      return deriveFromRealResult(s.verificationResult, s, t, lang);
    }

    const RED = paletteColors.error;
    const alert = currentScenario === "alert";
    const suspicious = currentScenario === "suspicious";
    const color = alert ? RED : suspicious ? WARN : OK;
    const wash = alert ? "rgba(255,59,48,.13)" : suspicious ? "rgba(255,159,10,.14)" : "rgba(48,209,88,.15)";
    const chipInk = alert ? paletteColors.washRedInk : suspicious ? paletteColors.washOrangeInk : paletteColors.washGreenInk;
    const done = Math.floor(s.pct / 20);

    const mk = (pair: [string, string], ok: boolean) => ({
      label: pair[0],
      detail: pair[1],
      color: ok ? OK : WARN,
      icon: (ok ? "check" : "warn") as "check" | "warn",
    });
    const bad = (pair: [string, string]) => ({ label: pair[0], detail: pair[1], color: RED, icon: "warn" as const });
    const pkiWarn = suspicious && !s.online;

    const checkRows = alert
      ? [bad(t.checks.passiveFail), bad(t.checks.pkiFail), mk(t.checks.chipWarn, false), mk(t.checks.fields, true), bad(t.checks.faceFail)]
      : [
          mk(t.checks.passive, true),
          mk(pkiWarn ? t.checks.pkiWarn : t.checks.pkiOk, !pkiWarn),
          mk(t.checks.chip, true),
          mk(t.checks.fields, true),
          suspicious
            ? mk(t.checks.faceWarn, false)
            : { label: t.checks.faceNone[0], detail: t.checks.faceNone[1], color: INFO, icon: "dash" as const },
        ];

    const anomKeys = alert
      ? (["sodHash", "dscUnknown", "faceMismatch"] as const)
      : suspicious
        ? s.online
          ? (["liveness", "csca"] as const)
          : (["liveness", "revocation", "csca"] as const)
        : (["csca"] as const);
    const anomalyRows = anomKeys.map((k) => {
      const a = t.anomalies[k];
      return { code: a[0], sev: a[1], message: a[2], color: a[1] === "critical" ? RED : a[1] === "warning" ? WARN : INFO };
    });

    const ink = (a: number) => `rgba(${paletteColors.inkBaseRgb},${a})`;
    const dgRows = t.dgs.map((g, i) => ({
      id: g.id,
      label: g.label,
      tone: i < done ? ink(0.55) : i === done ? paletteColors.inkPrimary : ink(0.3),
      state: i < done ? ("done" as const) : i === done ? ("current" as const) : ("upcoming" as const),
      markTone: i < done ? OK : i === done ? "#0A84FF" : ink(0.22),
    }));

    const procRows = t.procSteps.slice(0, suspicious || alert ? 5 : 4).map((label, i) => ({
      label,
      dot: i < 3 ? OK : ink(0.2),
      tone: i < 3 ? ink(0.6) : paletteColors.inkPrimary,
    }));

    const fieldRows = t.fields.map((f, i) => ({ label: f[0], value: f[1], checks: f[2], color: OK, first: i === 0 }));
    const chainRows = (alert ? t.chainAlert : t.chain).map((c, i) => ({
      title: c[0],
      state: c[1],
      subject: c[2],
      note: c[3],
      color: alert ? RED : OK,
      isLast: i === 2,
    }));
    const trustRows = embeddedStoreRows(lang).map(([label, value], i) => ({ label, value, first: i === 0 }));
    const countryRows = embeddedCountryRows(lang, t.anchorsWord);

    return {
      t,
      alert,
      suspicious,
      authentic: !alert && !suspicious,
      langLabel: lang === "en" ? "EN" : "FR",
      scenarioLabel: alert ? "rejected" : suspicious ? "suspicious" : "authentic",
      faceImageUri: undefined as string | undefined,
      darkScreen: s.step === "mrz" || s.step === "selfie" || s.scheme === "dark",
      screenBg: s.step === "mrz" || s.step === "selfie" ? paletteColors.screenDark : paletteColors.screenLight,
      pctLabel: `${s.pct} %`,
      pct: s.pct,
      barWidth: `${s.pct}%`,
      online: s.online,
      homeSub: s.online ? t.homeSubOnline : t.homeSub,
      modeLabel: s.online ? t.modeOnline : t.modeOffline,
      modeDesc: s.online ? t.modeOnlineDesc : t.modeOfflineDesc,
      modeDot: s.online ? OK : "#0A84FF",
      trustLineNow: fillStoreStats(s.online ? t.trustLineOnline : t.trustLine),
      procNote: s.online ? t.procNoteOnline : t.procNote,
      showTabs: TAB_STEPS.includes(s.step),
      livePhase: s.livePhase,
      liveDone: s.livePhase >= 3,
      liveTitle: t.livePhases[s.livePhase] ?? t.livePhases[0],
      liveSub: t.livePhaseSub[s.livePhase] ?? t.livePhaseSub[0],
      liveAccent: s.livePhase >= 3 ? "#30D158" : "#0A84FF",
      liveDots: [0, 1, 2].map((i) => ({
        bg: s.livePhase > i || s.livePhase >= 3 ? "#30D158" : s.livePhase === i ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.25)",
      })),
      decisionTitle: alert ? t.decisionAlert : suspicious ? t.decisionSusp : t.decisionAuth,
      decisionSub: alert ? t.decisionAlertSub : suspicious ? (s.online ? t.decisionSuspSubOnline : t.decisionSuspSub) : t.decisionAuthSub,
      decisionBg: alert ? paletteColors.washRedBg : suspicious ? paletteColors.washOrangeBg : paletteColors.washGreenBg,
      decisionBorder: alert ? paletteColors.washRedBorder : suspicious ? paletteColors.washOrangeBorder : paletteColors.washGreenBorder,
      passedLabel: `${alert ? "7 " : suspicious ? (s.online ? "10 " : "9 ") : "11 "}${t.passedLine} 11`,
      verdictColor: color,
      verdictWash: wash,
      verdictChipLabel: alert ? t.verdicts.alert : suspicious ? t.verdicts.suspicious : t.verdicts.authentic,
      verdictChipInk: chipInk,
      anomalyCount: anomalyRows.length,
      checkRows,
      anomalyRows,
      dgRows,
      procRows,
      fieldRows,
      chainRows,
      trustRows,
      countryRows,
      verifiedLine: s.online ? t.verifiedLineOnline : t.verifiedLine,
      supported: t.types3.map((d) => ({ name: d[0], format: d[1] })),
      idCard: {
        countryCode: "FRA",
        docTypeLabel: t.idDocTypes.ePassport,
        surname: "MARTIN",
        givenNames: "Camille Élise",
        birthDate: "12/04/1991",
        sex: "F",
        nationality: "FRA",
        documentNumber: "21FR34567",
        expiryDate: "30/08/2031",
      } as IdCardView,
      identitySurname: "MARTIN",
      identityGivenNames: "Camille Élise",
      identityTechLine: `FRA · TD3 · 21FR34567\n${t.expLabel} 30/08/2031`,
      identityFieldsCount: 12,
      chainDetailValue: "ICAO PKD",
    };
  }, [lang, currentScenario, s.pct, s.online, s.step, s.livePhase, s.verificationResult, s.server, s.scheme, paletteColors]);

  return {
    step: s.step,
    anim: s.anim,
    feedbackOn: s.feedbackOn,
    requireRevocationCheck: s.requireRevocationCheck,
    requireLostStolenCheck: s.requireLostStolenCheck,
    lang,
    scenario: currentScenario,
    showShare: s.showShare,
    mrzForm: s.mrzForm,
    mrzFormValid,
    verificationStatus: s.verificationStatus,
    verificationError: s.verificationError,
    scheme: s.scheme,
    colors: paletteColors,
    ...derived,
    modeDesc: !isBackendReady(s.backend) && !s.online ? derived.t.modeServerMissing : derived.modeDesc,
    backend: s.backend,
    backendReady: isBackendReady(s.backend),
    refreshBackend,
    goServer: () => go("server", "push"),
    backFromServer: () => go("settings", "back"),
    startScan,
    updateMrzForm,
    submitMrz,
    beginNfc,
    reset,
    go,
    goTrust: () => go("trust", "tab"),
    goTrustPush: () => go("trust", "push"),
    goSettings: () => go("settings", "tab"),
    goFields: () => go("fields"),
    goChain: () => go("chain"),
    goAnomalies: () => go("anomalies"),
    goVerdict: () => go("verdict", "back"),
    goCountries: () => go("countries"),
    backFromCountries: () => go("trust", "back"),
    selectedCountry: s.selectedCountry,
    openCountry: (code: string) => {
      clear();
      setS((prev) => ({ ...prev, step: "country", anim: "push", showShare: false, selectedCountry: code }));
    },
    backFromCountry: () => go("countries", "back"),
    toggleFeedback,
    toggleRevocationCheck,
    toggleLostStolenCheck,
    toggleFaceMatch,
    faceMatchEnabled: s.faceMatchEnabled,
    faceMatchAvailable: FaceKit !== null,
    /** Défi de vivacité active possible : mode en ligne, serveur prêt (le défi est émis et vérifié par lui). */
    activeLivenessPossible: s.online && isBackendReady(s.backend),
    /** Écran selfie en mode réel (caméra frontale) plutôt que l'animation de démonstration. */
    realSelfie: s.chipResult !== null && s.verificationResult === null,
    completeSelfie,
    openShare,
    closeShare,
    toggleOnline,
    toggleLang,
    toggleScenario,
    toggleScheme,
  };
}

const REQUESTED_FIELDS = ["documentNumber", "dateOfBirth", "dateOfExpiry", "nationality", "sex", "primaryIdentifier", "secondaryIdentifier"];

/** Résultat de l'écran selfie côté vivacité active (SelfieScreen.tsx › ActiveSelfie). */
export interface SelfieLiveness {
  /** Réponse au défi, à envoyer au serveur ; `clockOffsetMs` : heure serveur − heure du téléphone. */
  active?: { submission: ActiveLivenessSubmission; clockOffsetMs: number };
  /** Pourquoi il n'y a pas de vivacité active (défi non réalisé, échoué, indisponible). */
  note?: string;
}

/** Mode en ligne : la puce lue, le selfie JPEG et, si réalisée, la réponse au défi de vivacité active. */
function buildServerSubmission(
  documentType: DocumentType,
  chipResult: EmrtdReadResult,
  selfie: NativeFaceCrop | null,
  activeLiveness: ActiveLivenessSubmission | undefined,
): ServerSubmission {
  const activeAuthentication = chipResult.activeAuthentication?.response
    ? { challenge: chipResult.activeAuthentication.challenge, responseDer: chipResult.activeAuthentication.response }
    : undefined;
  return {
    documentType,
    chipDataBase64: encodeChipDataEnvelope({ sod: chipResult.sod, dataGroups: chipResult.dataGroups, activeAuthentication }),
    liveCaptureBase64: selfie?.jpeg,
    requestedFields: REQUESTED_FIELDS,
    activeLiveness,
  };
}

/**
 * Attend le résultat signé du serveur KYC. Sans résultat à temps (réseau, serveur occupé), la
 * soumission part dans la file d'attente — déjà acceptée (`verificationId`) : seulement réconciliée
 * plus tard ; sinon renvoyée plus tard, SANS la réponse de vivacité active (son défi aura expiré :
 * elle serait jugée échouée alors qu'elle n'a simplement pas pu être transmise à temps).
 */
async function settleServerOutcome(
  pending: Promise<ServerOutcome>,
  submission: ServerSubmission,
  localResult: LocalVerificationResult,
): Promise<ServerState> {
  const outcome = await pending;
  if (__DEV__) console.log(`[KYC] ${outcome.kind}${outcome.kind === "failed" ? ` : ${outcome.error}` : ` · ${outcome.verificationId}`}`);
  if (outcome.kind === "result") return { phase: "done", outcome, queued: false };
  const { activeLiveness: _expiresSoon, ...queued } = submission;
  try {
    await enqueueSubmission(
      { ...queued, localResult },
      outcome.kind === "pending" ? { verificationId: outcome.verificationId } : { lastError: outcome.error },
    );
    return { phase: "done", outcome, queued: true };
  } catch {
    return { phase: "done", outcome, queued: false };
  }
}

/** Ligne « Serveur KYC » du verdict : résultat signé, en attente ou échec (mode en ligne seulement). */
function serverCheckRow(server: ServerState | null, red: string) {
  const label = "Serveur KYC";
  if (!server) return null;
  if (server.phase === "sending") return { label, detail: "Envoi en cours…", color: INFO, icon: "dash" as const };
  const o = server.outcome;
  const queued = server.queued ? " — mis en file d'attente, réconcilié automatiquement" : "";
  if (o.kind === "result") {
    return o.signatureValid
      ? { label, detail: `Résultat signé (clé épinglée vérifiée) · ${o.verificationId.slice(0, 8)}`, color: OK, icon: "check" as const }
      : { label, detail: "Signature du résultat absente ou invalide — résultat serveur ignoré", color: red, icon: "warn" as const };
  }
  if (o.kind === "pending") return { label, detail: `Traitement serveur en cours${queued}`, color: WARN, icon: "warn" as const };
  return { label, detail: `${o.error}${queued}`, color: WARN, icon: "warn" as const };
}

/**
 * Ligne « Anti-clonage » du verdict. Doc 9303 Part 11 : Active Authentication (§6.1, clé DG15) et
 * Chip Authentication (§6.2, clé DG14) sont deux mécanismes optionnels et interchangeables — la
 * CA étant l'alternative recommandée (pas de preuve transférable, nouvelles clés de session). Une
 * seule preuve réussie suffit ; un mécanisme qui ÉCHOUE reste signalé en rouge même si l'autre a
 * réussi (incohérent pour une vraie puce). Le détail reste dans les anomalies.
 */
function antiCloningRow(result: LocalVerificationResult, dg14: Uint8Array | undefined, red: string) {
  const label = "Anti-clonage (puce authentique)";
  const aa = result.activeAuthentication;
  const ca = dg14AnnouncesChipAuthentication(dg14) ? result.chipAuthentication : undefined;
  if (!aa && !ca) {
    return { label, detail: "Non proposé par ce document (ni AA ni CA)", color: INFO, icon: "dash" as const };
  }
  const caName = ca?.protocol === "PACE-CAM" ? "Chip Authentication pendant PACE (CAM)" : "Chip Authentication";
  const why = (reason?: string) => (reason ? ` — ${reason}` : "");

  const failures: string[] = [];
  if (ca?.performed && !ca.valid) failures.push(`CA échouée : la puce ne détient pas la clé privée de DG14${why(ca.reason)}`);
  if (aa?.performed && !aa.valid) failures.push(`AA échouée : signature du défi invalide${why(aa.reason)}`);
  if (failures.length > 0) return { label, detail: failures.join(" · "), color: red, icon: "warn" as const };

  const proven = [...(ca?.valid ? [caName] : []), ...(aa?.valid ? ["Active Authentication"] : [])];
  if (proven.length > 0) {
    const pending = [...(ca && !ca.valid ? ["CA non aboutie"] : []), ...(aa && !aa.valid ? ["AA non aboutie"] : [])];
    return { label, detail: `Prouvé par ${proven.join(" et ")}${pending.length ? ` (${pending.join(", ")})` : ""}`, color: OK, icon: "check" as const };
  }

  const notDone = [...(ca ? [`CA non aboutie${why(ca.reason)}`] : []), ...(aa ? [`AA non aboutie${why(aa.reason)}`] : [])];
  return { label, detail: `Annoncé par le document mais non prouvé : ${notDone.join(" · ")}`, color: WARN, icon: "warn" as const };
}

const FACE_WARNINGS: Record<string, string> = {
  image_too_blurry: "selfie flou",
  image_resolution_too_low: "selfie trop petit",
  multiple_faces_detected: "plusieurs visages",
  no_face_detected: "aucun visage",
};

/** Ligne « Reconnaissance faciale » du verdict : score SFace et décision, ou pourquoi elle manque. */
function faceCheckRow(result: LocalVerificationResult, note: string | null, red: string) {
  const fm = result.faceMatch;
  if (!fm) {
    return { label: "Reconnaissance faciale", detail: note ?? "Non réalisée", color: INFO, icon: "dash" as const };
  }
  const score = fm.similarityScore.toFixed(2).replace(".", ",");
  const quality = fm.qualityWarnings.map((w) => FACE_WARNINGS[w] ?? w).join(", ");
  const decision =
    fm.matchDecision === "match" ? "même personne" : fm.matchDecision === "no_match" ? "personne différente" : "ressemblance incertaine";
  const ok = fm.matchDecision === "match" && fm.livenessPassed;
  return {
    label: "Reconnaissance faciale",
    detail: `Similarité ${score} · ${decision}${quality ? ` · ${quality}` : ""}`,
    color: ok ? OK : fm.matchDecision === "no_match" ? red : WARN,
    icon: (ok ? "check" : "warn") as "check" | "warn",
  };
}

/**
 * Construit le même objet `derived` que le mode démo, mais à partir d'un vrai
 * `LocalVerificationResult` (lecture NFC + vérification locale réelles) plutôt que des tables de
 * copie canned par scénario. Les écrans (VerdictScreen/FieldsScreen/ChainScreen/AnomaliesScreen/
 * NfcScreen/ProcessingScreen) consomment `derived` sans savoir s'il vient du mode démo ou réel.
 */
function deriveFromRealResult(
  result: LocalVerificationResult,
  s: RawState,
  t: ReturnType<typeof copyFor>,
  lang: Lang,
) {
  const paletteColors: PaletteColors = paletteFor(s.scheme);
  const RED = paletteColors.error;
  const ink = (a: number) => `rgba(${paletteColors.inkBaseRgb},${a})`;
  // Mode en ligne : le résultat du serveur ne fait foi que signé par la clé épinglée.
  const serverOutcome = s.server?.phase === "done" ? s.server.outcome : null;
  const signed = serverOutcome?.kind === "result" && serverOutcome.signatureValid ? serverOutcome.result : null;
  const verdict: Verdict = signed?.verdict ?? result.verdict;
  const alert = verdict === "rejected";
  const suspicious = verdict === "suspicious" || verdict === "manual_review_required";
  const color = alert ? RED : suspicious ? WARN : OK;
  const wash = alert ? "rgba(255,59,48,.13)" : suspicious ? "rgba(255,159,10,.14)" : "rgba(48,209,88,.15)";
  const chipInk = alert ? paletteColors.washRedInk : suspicious ? paletteColors.washOrangeInk : paletteColors.washGreenInk;

  const fieldEntries = Object.entries(result.document.fields);
  const fieldRows = fieldEntries.map(([label, f], i) => ({
    label,
    value: f.value,
    checks: f.checks.join(", "),
    color: f.valid ? OK : RED,
    first: i === 0,
  }));
  const allFieldsValid = fieldEntries.every(([, f]) => f.valid);

  const localCodes = new Set(result.anomalies.map((a) => a.code));
  const serverOnlyAnomalies = (signed?.anomalies ?? [])
    .filter((a) => !localCodes.has(a.code))
    .map((a) => ({
      ...a,
      message:
        `Serveur · ${a.message}` +
        // La Chip Authentication est un protocole interactif avec la puce : le serveur ne peut pas la rejouer.
        (a.code === "MISSING_ACTIVE_CHIP_AUTH" && result.chipAuthentication?.valid ? " — CA prouvée sur l'appareil, non transmissible au serveur" : ""),
    }));
  const anomalyRows = [...result.anomalies, ...serverOnlyAnomalies].map((a) => ({
    code: a.code,
    sev: a.severity,
    message: a.message,
    color: severityColor(a.severity, RED),
  }));

  const trust = result.trustChain;
  const pa = result.passiveAuthentication;
  const trustSourceLabel = pa.noTrustAnchorAvailable
    ? "Aucun CSCA de ce pays dans le magasin"
    : trust.source === "icao-pkd"
      ? "ICAO PKD"
      : trust.source === "national-pkd"
        ? "PKD national"
        : "Magasin de confiance étendu";
  const day = (iso: string) => iso.slice(0, 10);
  const certDetails = (c: NonNullable<typeof trust.csca>) => [
    { label: "Sujet", value: c.subject },
    { label: "Émetteur", value: c.issuer },
    { label: "N° de série", value: c.serialNumber },
    { label: "Validité", value: `${day(c.notBefore)} → ${day(c.notAfter)}` },
  ];
  const chainRows: Array<{
    title: string;
    state: string;
    subject: string;
    note: string;
    color: string;
    isLast: boolean;
    details?: { label: string; value: string }[];
  }> = [
    {
      title: "Ancre de confiance",
      state: trust.sufficientForClientPolicy ? "valide" : "insuffisante",
      subject: trustSourceLabel,
      note: `Niveau : ${trust.level}`,
      color: trust.sufficientForClientPolicy ? OK : RED,
      isLast: false,
    },
    ...(trust.csca
      ? [
          {
            title: "Certificat CSCA",
            state: pa.dscTrustedByCsca ? "a signé le DSC" : "ne signe pas ce DSC",
            subject: trust.csca.subject,
            note: "Autorité racine du pays émetteur (trust store embarqué) — celle dont la clé a signé le DSC.",
            color: pa.dscTrustedByCsca ? OK : RED,
            isLast: false,
            details: certDetails(trust.csca),
          },
        ]
      : []),
    ...(trust.dsc
      ? [
          {
            title: "Certificat DSC",
            state: pa.sodSignatureValid ? "a signé le SOD" : "signature SOD invalide",
            subject: trust.dsc.subject,
            note: pa.dscWithinValidityPeriod ? "Signataire du document (embarqué dans le SOD)." : "Hors de sa période de validité.",
            color: pa.sodSignatureValid && pa.dscWithinValidityPeriod ? OK : RED,
            isLast: false,
            details: certDetails(trust.dsc),
          },
        ]
      : []),
    {
      title: "Empreintes des DG (SOD)",
      state: pa.dataGroupHashMismatches.length === 0 ? "conformes" : "divergentes",
      subject: `Vérifiés : ${pa.dataGroupsVerified.map((n) => `DG${n}`).join(", ") || "aucun"}`,
      note:
        (pa.dataGroupHashMismatches.length > 0 ? `Divergents : ${pa.dataGroupHashMismatches.map((n) => `DG${n}`).join(", ")}. ` : "") +
        (pa.dataGroupsNotRead.length > 0
          ? `Déclarés mais non lus (normal, ex. DG3 protégé par EAC) : ${pa.dataGroupsNotRead.map((n) => `DG${n}`).join(", ")}.`
          : ""),
      color: pa.dataGroupHashMismatches.length === 0 ? OK : RED,
      isLast: false,
    },
    {
      title: "Révocation",
      state: trust.revoked ? "révoqué" : !trust.revocationChecked ? "non vérifiée" : "non révoqué",
      subject: pa.revocationList ? `CRL du ${day(pa.revocationList.thisUpdate)}` : "Aucune CRL disponible",
      note: pa.revocationList
        ? `${pa.revocationList.stale ? "CRL périmée" : "CRL à jour"}${pa.revocationList.nextUpdate ? ` · prochaine le ${day(pa.revocationList.nextUpdate)}` : ""} · signature vérifiée contre le CSCA`
        : "CRL introuvable (hors ligne, ou non publiée) : téléchargée automatiquement dès que le réseau le permet",
      color: trust.revoked ? RED : trust.revocationChecked ? OK : WARN,
      isLast: true,
    },
  ];

  // L'écran « Magasin de confiance » décrit le magasin lui-même ; la source et le niveau de
  // confiance de CE document sont sur l'écran « Chaîne de confiance » (chainRows).
  const trustRows = embeddedStoreRows(lang).map(([label, value], i) => ({ label, value, first: i === 0 }));

  const dgRows = Object.keys(s.chipResult?.dataGroups ?? {}).map((k) => {
    const id = Number(k);
    return {
      id: `DG${id}`,
      label: DG_LABELS[id] ?? `DG${id}`,
      tone: ink(0.55),
      state: "done" as const,
      markTone: OK,
    };
  });

  const passiveOk = pa.sodSignatureValid && pa.dataGroupHashMismatches.length === 0;
  const protocol = s.chipResult?.accessProtocolUsed ?? "BAC";
  const checkRows = [
    {
      label: "Authentification passive (SOD)",
      detail: passiveOk
        ? `Signature du SOD valide · ${pa.dataGroupsVerified.map((n) => `DG${n}`).join(", ")} conformes`
        : !pa.sodSignatureValid
          ? "Signature du SOD invalide"
          : `Empreintes divergentes : ${pa.dataGroupHashMismatches.map((n) => `DG${n}`).join(", ")}`,
      color: passiveOk ? OK : RED,
      icon: (passiveOk ? "check" : "warn") as "check" | "warn",
    },
    {
      label: "Chaîne de confiance PKI",
      detail: trustSourceLabel,
      color: trust.sufficientForClientPolicy ? OK : WARN,
      icon: (trust.sufficientForClientPolicy ? "check" : "warn") as "check" | "warn",
    },
    { label: `Accès à la puce (${protocol})`, detail: `Canal sécurisé ${protocol} établi avec succès`, color: OK, icon: "check" as const },
    antiCloningRow(result, s.chipResult?.dataGroups[14], RED),
    {
      label: "Champs du document",
      detail: `${fieldRows.length} champ${fieldRows.length > 1 ? "s" : ""} contrôlé${fieldRows.length > 1 ? "s" : ""}`,
      color: allFieldsValid ? OK : WARN,
      icon: (allFieldsValid ? "check" : "warn") as "check" | "warn",
    },
    {
      label: "Révocation des certificats (CRL)",
      detail: trust.revoked
        ? "DSC révoqué par le pays émetteur"
        : trust.revocationChecked
          ? `DSC non révoqué (CRL du ${pa.revocationList ? day(pa.revocationList.thisUpdate) : "?"})`
          : s.requireRevocationCheck
            ? "Exigée mais aucune CRL à jour disponible"
            : "Aucune CRL à jour disponible (non exigée)",
      color: trust.revocationChecked ? (trust.revoked ? RED : OK) : s.requireRevocationCheck ? WARN : INFO,
      icon: (trust.revocationChecked && !trust.revoked ? "check" : s.requireRevocationCheck || trust.revoked ? "warn" : "dash") as
        | "check"
        | "warn"
        | "dash",
    },
    lostStolenRow(signed, s.requireLostStolenCheck, RED),
    faceCheckRow(result, s.faceMatchNote, RED),
    livenessRow(result, signed, s.livenessNote, RED),
    ...[serverCheckRow(s.server, RED)].filter((row): row is NonNullable<typeof row> => row !== null),
  ];

  const procRows = [
    { label: "Lecture MRZ", dot: OK, tone: ink(0.6) },
    { label: "Lecture de la puce NFC", dot: OK, tone: ink(0.6) },
    {
      label: "Vérification locale",
      dot: s.verificationStatus === "verifying" ? ink(0.2) : OK,
      tone: s.verificationStatus === "verifying" ? paletteColors.inkPrimary : ink(0.6),
    },
  ];

  // Score sur les seuls contrôles exigés : les lignes grises (non exigés / non réalisés) ne comptent pas.
  const requiredChecks = checkRows.filter((c) => c.color !== INFO);
  const passedCount = requiredChecks.filter((c) => c.color === OK).length;
  const shownAnomalies = signed ? signed.anomalies : result.anomalies;
  const blockingAnomalies = shownAnomalies.filter((a) => a.severity !== "info").length;
  const skippedCount = shownAnomalies.length - blockingAnomalies;
  const verdictSource = signed ? "Verdict du serveur KYC (signé)" : "Verdict local provisoire";

  return {
    t,
    alert,
    suspicious,
    authentic: !alert && !suspicious,
    langLabel: lang === "en" ? "EN" : "FR",
    scenarioLabel: signed ? (lang === "en" ? "server" : "serveur") : lang === "en" ? "provisional" : "provisoire",
    darkScreen: s.step === "mrz" || s.step === "selfie" || s.scheme === "dark",
    screenBg: s.step === "mrz" || s.step === "selfie" ? paletteColors.screenDark : paletteColors.screenLight,
    pctLabel: `${s.pct} %`,
    pct: s.pct,
    barWidth: `${s.pct}%`,
    online: s.online,
    homeSub: s.online ? t.homeSubOnline : t.homeSub,
    modeLabel: s.online ? t.modeOnline : t.modeOffline,
    modeDesc: s.online ? t.modeOnlineDesc : t.modeOfflineDesc,
    modeDot: s.online ? OK : "#0A84FF",
    trustLineNow: fillStoreStats(s.online ? t.trustLineOnline : t.trustLine),
    procNote: s.server ? t.procNoteOnline : "Vérification locale, sur l'appareil.",
    showTabs: TAB_STEPS.includes(s.step),
    livePhase: s.livePhase,
    liveDone: s.livePhase >= 3,
    liveTitle: t.livePhases[0],
    liveSub: t.livePhaseSub[0],
    liveAccent: "#0A84FF",
    liveDots: [0, 1, 2].map(() => ({ bg: "rgba(255,255,255,.25)" })),
    decisionTitle: alert
      ? "Document rejeté"
      : verdict === "manual_review_required"
        ? "Vérification manuelle requise"
        : suspicious
          ? "Document suspect"
          : "Document authentique",
    decisionSub:
      (blockingAnomalies === 0
        ? `${verdictSource} — aucune anomalie.`
        : `${verdictSource} — ${blockingAnomalies} anomalie${blockingAnomalies > 1 ? "s" : ""} détectée${blockingAnomalies > 1 ? "s" : ""}.`) +
      (skippedCount > 0 ? ` ${skippedCount} contrôle${skippedCount > 1 ? "s" : ""} non exigé${skippedCount > 1 ? "s" : ""}.` : "") +
      (signed && signed.verdict !== result.verdict ? ` Verdict local : ${VERDICT_FR[result.verdict]}.` : ""),
    decisionBg: alert ? paletteColors.washRedBg : suspicious ? paletteColors.washOrangeBg : paletteColors.washGreenBg,
    decisionBorder: alert ? paletteColors.washRedBorder : suspicious ? paletteColors.washOrangeBorder : paletteColors.washGreenBorder,
    passedLabel: `${passedCount} vérification${passedCount > 1 ? "s" : ""} passée${passedCount > 1 ? "s" : ""} sur ${requiredChecks.length}`,
    verdictColor: color,
    verdictWash: wash,
    verdictChipLabel: alert ? t.verdicts.alert : suspicious ? t.verdicts.suspicious : t.verdicts.authentic,
    faceImageUri: result.faceImage?.dataUri,
    verdictChipInk: chipInk,
    anomalyCount: anomalyRows.length,
    checkRows,
    anomalyRows,
    dgRows,
    procRows,
    fieldRows,
    chainRows,
    trustRows,
    countryRows: embeddedCountryRows(lang, t.anchorsWord),
    verifiedLine: signed
      ? `Résultat signé par le serveur KYC · ${signed.verificationId} · ${signed.verifiedAt.slice(0, 16).replace("T", " ")}`
      : s.server?.phase === "done" && s.server.queued
        ? "Vérification locale provisoire — envoyée au serveur KYC dès qu'il répondra (file d'attente)."
        : "Vérification locale — résultat provisoire tant qu'aucune réconciliation backend n'a eu lieu.",
    supported: t.types3.map((d) => ({ name: d[0], format: d[1] })),
    idCard: {
      countryCode: result.document.issuingCountry,
      docTypeLabel: t.idDocTypes[result.document.type as keyof typeof t.idDocTypes] ?? result.document.type,
      surname: result.document.fields.primaryIdentifier?.value || "—",
      givenNames: (result.document.fields.secondaryIdentifier?.value || "—").replace(/\s+/g, " "),
      birthDate: isoToDisplayDate(result.document.fields.dateOfBirth?.value),
      sex: ({ M: "M", F: "F", unspecified: "—", X: "X" } as Record<string, string>)[result.document.fields.sex?.value ?? ""] ?? "—",
      nationality: result.document.fields.nationality?.value || "—",
      documentNumber: result.document.fields.documentNumber?.value || "—",
      expiryDate: isoToDisplayDate(result.document.fields.dateOfExpiry?.value),
    } as IdCardView,
    identitySurname: result.document.fields.primaryIdentifier?.value ?? "—",
    identityGivenNames: result.document.fields.secondaryIdentifier?.value ?? "—",
    identityTechLine: `${result.document.issuingCountry} · ${result.document.type}\n${result.document.fields.documentNumber?.value ?? "—"}`,
    identityFieldsCount: fieldRows.length,
    chainDetailValue: trustSourceLabel,
  };
}

const VERDICT_FR: Record<Verdict, string> = {
  authentic: "authentique",
  suspicious: "suspect",
  manual_review_required: "revue manuelle",
  rejected: "rejeté",
};

/** Registre perdus/volés : interrogé par le serveur en ligne (résultat signé), injoignable hors ligne. */
function lostStolenRow(signed: VerificationResult | null, required: boolean, red: string) {
  const label = "Registre perdus/volés";
  if (signed) {
    const codes = new Set(signed.anomalies.map((a) => a.code));
    if (codes.has("DOCUMENT_REPORTED_LOST_OR_STOLEN")) return { label, detail: "Document signalé perdu ou volé", color: red, icon: "warn" as const };
    if (codes.has("LOST_STOLEN_STATUS_NOT_CHECKED") || codes.has("LOST_STOLEN_CHECK_DISABLED")) {
      return { label, detail: "Registre non interrogé par le serveur", color: WARN, icon: "warn" as const };
    }
    return { label, detail: "Non signalé (registre interrogé par le serveur)", color: OK, icon: "check" as const };
  }
  return required
    ? { label, detail: "Exigé mais registre injoignable hors ligne", color: WARN, icon: "warn" as const }
    : { label, detail: "Non exigé (Réglages)", color: INFO, icon: "dash" as const };
}

/** Ligne « Vivacité » : défi actif TrueDepth (vérifié par le serveur s'il a répondu) ou passive seulement. */
function livenessRow(result: LocalVerificationResult, signed: VerificationResult | null, note: string | null, red: string) {
  const label = "Vivacité";
  const active = signed ? signed.activeLiveness : result.activeLiveness;
  const by = signed ? "vérifié par le serveur" : "vérification locale";
  if (active?.performed) {
    return active.passed
      ? { label, detail: `Active (caméra TrueDepth) · défi réussi, ${by}`, color: OK, icon: "check" as const }
      : { label, detail: `Active (caméra TrueDepth) · défi échoué, ${by}`, color: red, icon: "warn" as const };
  }
  const passiveOnly = signed?.anomalies.find((a) => a.code === "LIVENESS_PASSIVE_ONLY");
  const why = note ? ` — ${note}` : "";
  if (passiveOnly?.severity === "info") return { label, detail: `Passive seulement (active non exigée pour ce client)${why}`, color: INFO, icon: "dash" as const };
  if (passiveOnly) return { label, detail: `Passive seulement : active exigée pour ce client${why}`, color: WARN, icon: "warn" as const };
  return { label, detail: `Passive seulement (selfie guidé)${why}`, color: INFO, icon: "dash" as const };
}

function severityColor(sev: AnomalySeverity, RED: string) {
  return sev === "critical" ? RED : sev === "warning" ? WARN : INFO;
}

export type AuthentikDemo = ReturnType<typeof useAuthentikDemo>;
