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
 * Hors périmètre de ce premier branchement réel (voir conversation) : liveness active (le module
 * natif ARKit n'existe pas encore, voir apps/mobile/src/liveness/faceLivenessSession.ts) et
 * reconnaissance faciale (aucun détecteur de visage ni décodeur JPEG on-device dans ce dépôt) — le
 * flux réel saute donc directement de "nfc" à "processing" sans passer par "selfie". La
 * réconciliation backend (apps/mobile/src/sync/submissionQueue.ts) n'est pas non plus déclenchée
 * ici : `appConfig` (apps/mobile/src/config.ts) n'a pas d'URL/clé d'API réelles configurées, et
 * sans bundle CSCA synchronisé (`syncCscaBundle`), `computeLocalVerification` n'aura aucune ancre
 * de confiance locale — un document pourtant authentique affichera donc `NO_TRUST_ANCHOR` tant que
 * ni l'un ni l'autre n'est branché. Voir README de ce dossier pour le détail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NfcError } from "react-native-nfc-manager";
import type { AnomalySeverity, DocumentType, Verdict } from "@emrtd-verify/shared-types";
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
import { computeLocalVerification, LocalVerificationError, type LocalVerificationResult } from "../verification/localVerification";

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
  | "settings";

/** Transition d'entrée de l'écran — table `ANIM` du design v2 (voir components/ScreenTransition.tsx). */
export type ScreenAnim = "push" | "back" | "modal" | "fade" | "tab" | "verdict" | "none";

const TAB_STEPS: Step[] = ["home", "trust", "countries", "settings"];

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
}

export function useAuthentikDemo() {
  const [s, setS] = useState<RawState>({
    step: "home",
    anim: "none",
    feedbackOn: true,
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

  // Mode réel : lecture NFC PACE/BAC réelle (readEmrtdChip) puis vérification locale réelle
  // (computeLocalVerification), sans liveness ni reconnaissance faciale (voir en-tête du fichier).
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
    setS((prev) => ({ ...prev, pct: 100, chipResult, step: "processing", anim: "fade", verificationStatus: "verifying" }));

    try {
      const result = await computeLocalVerification({
        documentType: mrzForm.documentType,
        chipData: { sod: chipResult.sod, dataGroups: chipResult.dataGroups },
        requestedFields: ["documentNumber", "dateOfBirth", "dateOfExpiry", "nationality", "sex", "primaryIdentifier", "secondaryIdentifier"],
      });
      setS((prev) => ({ ...prev, verificationResult: result, verificationStatus: "idle", step: "verdict", anim: "verdict" }));
      fb(result.verdict === "rejected" ? "error" : result.verdict === "authentic" ? "success" : "warning");
    } catch (error) {
      const described = describeVerificationError(error);
      fb("error");
      setS((prev) => ({ ...prev, step: "place", anim: "back", verificationStatus: "idle", verificationError: described }));
    }
  }, [clear, fb]);

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

  const toggleOnline = useCallback(() => setS((prev) => ({ ...prev, online: !prev.online })), []);
  const toggleScheme = useCallback(
    () => setS((prev) => ({ ...prev, scheme: prev.scheme === "dark" ? "light" : "dark" })),
    [],
  );
  const toggleFeedback = useCallback(() => setS((prev) => ({ ...prev, feedbackOn: !prev.feedbackOn })), []);
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
    const trustRows = t.trust.map((r, i) => ({ label: r[0], value: r[1], first: i === 0 }));
    const countryRows = t.countries.map((c) => ({ code: c[0], flag: c[1], name: c[2], anchors: `${c[3]} ${t.anchorsWord}` }));

    return {
      t,
      alert,
      suspicious,
      authentic: !alert && !suspicious,
      langLabel: lang === "en" ? "EN" : "FR",
      scenarioLabel: alert ? "rejected" : suspicious ? "suspicious" : "authentic",
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
      trustLineNow: s.online ? t.trustLineOnline : t.trustLine,
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
      identitySurname: "MARTIN",
      identityGivenNames: "Camille Élise",
      identityTechLine: `FRA · TD3 · 21FR34567\n${t.expLabel} 30/08/2031`,
      identityFieldsCount: 12,
      chainDetailValue: "ICAO PKD",
    };
  }, [lang, currentScenario, s.pct, s.online, s.step, s.livePhase, s.verificationResult, s.scheme, paletteColors]);

  return {
    step: s.step,
    anim: s.anim,
    feedbackOn: s.feedbackOn,
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
    toggleFeedback,
    openShare,
    closeShare,
    toggleOnline,
    toggleLang,
    toggleScenario,
    toggleScheme,
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
  const verdict: Verdict = result.verdict;
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

  const anomalyRows = result.anomalies.map((a) => ({
    code: a.code,
    sev: a.severity,
    message: a.message,
    color: severityColor(a.severity, RED),
  }));

  const trust = result.trustChain;
  const trustSourceLabel = trust.source === "icao-pkd" ? "ICAO PKD" : trust.source === "national-pkd" ? "PKD national" : "Magasin de confiance étendu";
  const chainRows = [
    {
      title: "Ancre de confiance",
      state: trust.sufficientForClientPolicy ? "valide" : "insuffisante",
      subject: trustSourceLabel,
      note: `Niveau : ${trust.level}`,
      color: trust.sufficientForClientPolicy ? OK : RED,
      isLast: false,
    },
    ...(trust.cscaSubject
      ? [{ title: "Certificat CSCA", state: "présent", subject: trust.cscaSubject, note: "Autorité racine du pays émetteur", color: OK, isLast: false }]
      : []),
    ...(trust.dscSubject
      ? [{ title: "Certificat DSC", state: "présent", subject: trust.dscSubject, note: "Signataire du document", color: OK, isLast: false }]
      : []),
    {
      title: "Révocation",
      state: !trust.revocationChecked ? "non vérifiée" : trust.revoked ? "révoqué" : "non révoqué",
      subject: trustSourceLabel,
      note: trust.revocationChecked ? "Vérifiée localement" : "Nécessite une synchronisation backend",
      color: trust.revoked ? RED : trust.revocationChecked ? OK : WARN,
      isLast: true,
    },
  ];

  const trustRows = [
    { label: "Source", value: trustSourceLabel, first: true },
    { label: "Niveau", value: trust.level, first: false },
    { label: "Conforme à la politique client", value: trust.sufficientForClientPolicy ? "oui" : "non", first: false },
    { label: "Révocation vérifiée", value: trust.revocationChecked ? "oui" : "non", first: false },
  ];

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

  const checkRows = [
    { label: "Authentification passive (SOD)", detail: "Empreintes des groupes de données vérifiées", color: OK, icon: "check" as const },
    {
      label: "Chaîne de confiance PKI",
      detail: trustSourceLabel,
      color: trust.sufficientForClientPolicy ? OK : WARN,
      icon: (trust.sufficientForClientPolicy ? "check" : "warn") as "check" | "warn",
    },
    { label: "Authentification de la puce (BAC)", detail: "Canal sécurisé établi avec succès", color: OK, icon: "check" as const },
    {
      label: "Champs du document",
      detail: `${fieldRows.length} champ${fieldRows.length > 1 ? "s" : ""} contrôlé${fieldRows.length > 1 ? "s" : ""}`,
      color: allFieldsValid ? OK : WARN,
      icon: (allFieldsValid ? "check" : "warn") as "check" | "warn",
    },
    { label: "Reconnaissance faciale", detail: "Non réalisée dans ce PoC", color: INFO, icon: "dash" as const },
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

  const passedCount = 4 - (allFieldsValid ? 0 : 1) - (trust.sufficientForClientPolicy ? 0 : 1) - (result.anomalies.length > 0 ? 1 : 0);

  return {
    t,
    alert,
    suspicious,
    authentic: !alert && !suspicious,
    langLabel: lang === "en" ? "EN" : "FR",
    scenarioLabel: verdict,
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
    trustLineNow: s.online ? t.trustLineOnline : t.trustLine,
    procNote: "Vérification locale — voir README pour ce qui reste hors périmètre (liveness, reconnaissance faciale, réconciliation backend).",
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
    decisionSub: `Verdict local provisoire — ${result.anomalies.length} anomalie${result.anomalies.length > 1 ? "s" : ""} détectée${result.anomalies.length > 1 ? "s" : ""}.`,
    decisionBg: alert ? paletteColors.washRedBg : suspicious ? paletteColors.washOrangeBg : paletteColors.washGreenBg,
    decisionBorder: alert ? paletteColors.washRedBorder : suspicious ? paletteColors.washOrangeBorder : paletteColors.washGreenBorder,
    passedLabel: `${Math.max(0, passedCount)} vérifications passées sur 4`,
    verdictColor: color,
    verdictWash: wash,
    verdictChipLabel: verdict,
    verdictChipInk: chipInk,
    anomalyCount: anomalyRows.length,
    checkRows,
    anomalyRows,
    dgRows,
    procRows,
    fieldRows,
    chainRows,
    trustRows,
    countryRows: t.countries.map((c) => ({ code: c[0], flag: c[1], name: c[2], anchors: `${c[3]} ${t.anchorsWord}` })),
    verifiedLine: "Vérification locale — résultat provisoire tant qu'aucune réconciliation backend n'a eu lieu.",
    supported: t.types3.map((d) => ({ name: d[0], format: d[1] })),
    identitySurname: result.document.fields.primaryIdentifier?.value ?? "—",
    identityGivenNames: result.document.fields.secondaryIdentifier?.value ?? "—",
    identityTechLine: `${result.document.issuingCountry} · ${result.document.type}\n${result.document.fields.documentNumber?.value ?? "—"}`,
    identityFieldsCount: fieldRows.length,
    chainDetailValue: trustSourceLabel,
  };
}

function severityColor(sev: AnomalySeverity, RED: string) {
  return sev === "critical" ? RED : sev === "warning" ? WARN : INFO;
}

export type AuthentikDemo = ReturnType<typeof useAuthentikDemo>;
