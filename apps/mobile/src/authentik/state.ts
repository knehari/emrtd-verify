/**
 * Machine à états et valeurs dérivées — transcrites depuis la `class Component extends DCLogic`
 * du prototype HTML (`design_handoff_authentik/eMRTD Verify Mobile.dc.html`, méthodes `startScan`/
 * `runNfc`/`runSelfie`/`renderVals`, lues directement dans ce fichier). Mêmes minuteurs, mêmes
 * paliers, même logique de dérivation par scénario/langue/mode — voir le README du handoff §4
 * "Machine à états et navigation" et §8 "État applicatif" pour la spécification lisible.
 *
 * `scenario`/`lang` restent ici des commutateurs de DÉMONSTRATION (comme dans le prototype) : sans
 * matériel réel (puce eMRTD, capture vivante) pour piloter ce premier PoC, ce sont les seuls moyens
 * de parcourir les trois verdicts sur un appareil réel. En production, `scenario` viendrait du
 * moteur de vérification (`@emrtd-verify/verification-policy` déjà implémenté côté hors-ligne/API,
 * voir docs/pki-trust-model.md) et `lang` de la locale système — voir le README du handoff §8.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyFor, type Lang } from "./copy";

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
  | "countries";

const OK = "#30D158";
const WARN = "#FF9F0A";
const INFO = "#8E8E93";
const RED = "#FF3B30";

interface RawState {
  step: Step;
  langSel: Lang | null;
  scenarioSel: Scenario | null;
  pct: number;
  showShare: boolean;
  livePhase: number;
  online: boolean;
}

export function useAuthentikDemo() {
  const [s, setS] = useState<RawState>({
    step: "home",
    langSel: null,
    scenarioSel: null,
    pct: 0,
    showShare: false,
    livePhase: 0,
    online: false,
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
    (step: Step) => {
      clear();
      setS((prev) => ({ ...prev, step }));
    },
    [clear],
  );

  const scenario = useCallback((): Scenario => sRef.current.scenarioSel ?? "suspicious", []);

  const runSelfie = useCallback(() => {
    const scNow = scenario();
    const face = scNow === "suspicious" || scNow === "alert";
    if (!face) {
      setS((prev) => ({ ...prev, step: "processing" }));
      toRef.current = setTimeout(() => setS((prev) => ({ ...prev, step: "verdict" })), 1700);
      return;
    }
    setS((prev) => ({ ...prev, step: "selfie", livePhase: 0 }));
    tickRef.current = 0;
    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const n = Math.min(3, tickRef.current);
      setS((prev) => ({ ...prev, livePhase: n }));
      if (n >= 3) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        toRef.current = setTimeout(() => {
          setS((prev) => ({ ...prev, step: "processing" }));
          toRef.current = setTimeout(() => setS((prev) => ({ ...prev, step: "verdict" })), 1700);
        }, 1500);
      }
    }, 1400);
  }, [scenario]);

  const runNfc = useCallback(() => {
    setS((prev) => ({ ...prev, step: "nfc", pct: 0 }));
    tickRef.current = 0;
    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const p = Math.min(100, tickRef.current * 25);
      setS((prev) => ({ ...prev, pct: p }));
      if (p >= 100) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        toRef.current = setTimeout(() => runSelfie(), 550);
      }
    }, 700);
  }, [runSelfie]);

  const startScan = useCallback(() => {
    clear();
    setS((prev) => ({ ...prev, step: "mrz", pct: 0, showShare: false }));
    toRef.current = setTimeout(() => setS((prev) => ({ ...prev, step: "place" })), 1900);
  }, [clear]);

  const beginNfc = useCallback(() => {
    clear();
    runNfc();
  }, [clear, runNfc]);

  const reset = useCallback(() => {
    clear();
    setS((prev) => ({ ...prev, step: "home", pct: 0, showShare: false }));
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
      return { ...prev, scenarioSel: next, step: "home", showShare: false };
    });
  }, [clear]);

  const toggleOnline = useCallback(() => setS((prev) => ({ ...prev, online: !prev.online })), []);
  const openShare = useCallback(() => setS((prev) => ({ ...prev, showShare: true })), []);
  const closeShare = useCallback(() => setS((prev) => ({ ...prev, showShare: false })), []);

  const lang: Lang = s.langSel ?? "fr";
  const currentScenario: Scenario = s.scenarioSel ?? "suspicious";

  const derived = useMemo(() => {
    const t = copyFor(lang);
    const alert = currentScenario === "alert";
    const suspicious = currentScenario === "suspicious";
    const color = alert ? RED : suspicious ? WARN : OK;
    const wash = alert ? "rgba(255,59,48,.13)" : suspicious ? "rgba(255,159,10,.14)" : "rgba(48,209,88,.15)";
    const chipInk = alert ? "#B3261E" : suspicious ? "#B36A00" : "#1F7A38";
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

    const dgRows = t.dgs.map((g, i) => ({
      id: g.id,
      label: g.label,
      tone: i < done ? "rgba(60,60,67,.55)" : i === done ? "#000" : "rgba(60,60,67,.3)",
      state: i < done ? ("done" as const) : i === done ? ("current" as const) : ("upcoming" as const),
      markTone: i < done ? OK : i === done ? "#0A84FF" : "rgba(60,60,67,.22)",
    }));

    const procRows = t.procSteps.slice(0, suspicious || alert ? 5 : 4).map((label, i) => ({
      label,
      dot: i < 3 ? OK : "rgba(60,60,67,.2)",
      tone: i < 3 ? "rgba(60,60,67,.6)" : "#000",
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
      darkScreen: s.step === "mrz" || s.step === "selfie",
      screenBg: s.step === "mrz" || s.step === "selfie" ? "#0B0B0C" : "#F2F2F7",
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
      showTabs: s.step === "home" || s.step === "trust" || s.step === "countries",
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
      decisionBg: alert ? "#FDECEB" : suspicious ? "#FFF6E6" : "#EAF9EE",
      decisionBorder: alert ? "rgba(255,59,48,.28)" : suspicious ? "rgba(255,159,10,.3)" : "rgba(48,209,88,.3)",
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
    };
  }, [lang, currentScenario, s.pct, s.online, s.step, s.livePhase]);

  return {
    step: s.step,
    lang,
    scenario: currentScenario,
    showShare: s.showShare,
    ...derived,
    startScan,
    beginNfc,
    reset,
    go,
    goTrust: () => go("trust"),
    goFields: () => go("fields"),
    goChain: () => go("chain"),
    goAnomalies: () => go("anomalies"),
    goVerdict: () => go("verdict"),
    goCountries: () => go("countries"),
    backFromCountries: () => go("trust"),
    openShare,
    closeShare,
    toggleOnline,
    toggleLang,
    toggleScenario,
  };
}

export type AuthentikDemo = ReturnType<typeof useAuthentikDemo>;
