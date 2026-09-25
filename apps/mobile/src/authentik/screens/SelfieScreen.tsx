/**
 * Capture de vivacité — transcrit depuis le handoff, bloc `isSelfie`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 397-434, README §6.5).
 *
 * Mode réel (après une vraie lecture NFC) :
 * - vivacité ACTIVE (en ligne, serveur prêt, caméra TrueDepth) : défi aléatoire émis et signé par
 *   le serveur, exécuté avec ARKit (modules/face-kit FaceLivenessView, src/liveness/activeLiveness.ts),
 *   puis selfie pris dans la même session de suivi du visage ; la réponse part au serveur ;
 * - sinon, ou à défaut : caméra frontale (FaceCaptureView), séquence guidée cadrage → rotation de
 *   la tête → clignement (src/faceMatch/selfieLiveness.ts) — vivacité passive.
 * Le selfie part à la comparaison avec la photo de la puce (`demo.completeSelfie`). Mode démo :
 * l'animation d'origine du prototype.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  FaceCaptureView,
  FaceLivenessView,
  isTrueDepthAvailable,
  type FaceFrame,
  type LivenessCaptureEvent,
  type LivenessFrameEvent,
} from "../../../modules/face-kit";
import { requestLivenessChallenge } from "../../backend/backendClient";
import {
  ActiveLivenessRecorder,
  challengeEndsAt,
  challengePhaseAt,
  describeLivenessFailure,
  failedBeyondLight,
  isNeutralFrontal,
  lightColorAt,
} from "../../liveness/activeLiveness";
import { SelfieLivenessTracker, type SelfieHint, type SelfiePhase } from "../../faceMatch/selfieLiveness";
import type { NativeFaceCrop } from "../../faceMatch/faceCrop";
import { getSfaceSession } from "../../faceMatch/sfaceModel";
import { PressableFX as Pressable } from "../components/PressableFX";
import Svg, { Defs, RadialGradient, Stop, Rect, Path } from "react-native-svg";
import { BlurView } from "expo-blur";
import { colors } from "../theme";
import { BigCheckIcon } from "../icons";
import type { AuthentikDemo } from "../state";

const VIEWFINDER_W = 216;
const VIEWFINDER_H = 280;

function Sweep() {
  const translateY = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(translateY, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [translateY]);
  const y = translateY.interpolate({ inputRange: [-1, 1], outputRange: [-VIEWFINDER_H, VIEWFINDER_H * 3] });
  return <Animated.View style={[styles.sweep, { transform: [{ translateY: y }] }]} />;
}

function Breathe({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function PopIn({ children }: { children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
  }, [scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

export function SelfieScreen({ demo }: { demo: AuthentikDemo }) {
  // Choisi une fois à l'ouverture de l'écran ; l'écran actif peut basculer vers le selfie simple.
  const [passiveNote, setPassiveNote] = useState<string | null>(() =>
    demo.activeLivenessPossible && FaceLivenessView && isTrueDepthAvailable() ? null : "",
  );
  if (demo.realSelfie && passiveNote === null && FaceLivenessView) {
    return <ActiveSelfie demo={demo} onFallback={setPassiveNote} />;
  }
  return demo.realSelfie && FaceCaptureView ? <RealSelfie demo={demo} livenessNote={passiveNote || null} /> : <DemoSelfie demo={demo} />;
}

const DONE_DELAY_MS = 700;
const BLINK_NUDGE_MS = 6000;

function RealSelfie({ demo, livenessNote }: { demo: AuthentikDemo; livenessNote: string | null }) {
  const t = demo.t;
  const [permission, requestPermission] = useCameraPermissions();
  const tracker = useRef(new SelfieLivenessTracker()).current;
  const [phase, setPhase] = useState<SelfiePhase>(0);
  const [hint, setHint] = useState<SelfieHint>(null);
  const [captureRequest, setCaptureRequest] = useState(0);
  const [blinkSlow, setBlinkSlow] = useState(false);
  const captureRef = useRef<NativeFaceCrop | null>(null);
  const phaseRef = useRef<SelfiePhase>(0);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current || phaseRef.current !== 3 || !captureRef.current) return;
    doneRef.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const capture = captureRef.current;
    setTimeout(() => demo.completeSelfie(capture, livenessNote ? { note: livenessNote } : undefined), DONE_DELAY_MS);
  }, [demo, livenessNote]);

  const onFaceFrame = useCallback(
    (event: { nativeEvent: FaceFrame }) => {
      if (doneRef.current) return;
      const previous = phaseRef.current;
      const update = tracker.push(event.nativeEvent);
      if (update.phase === 0 && previous > 0) captureRef.current = null; // visage perdu : on reprend tout
      if (update.requestCapture) setCaptureRequest((n) => n + 1);
      if (update.phase !== previous) {
        phaseRef.current = update.phase;
        setPhase(update.phase);
        if (update.phase > previous) void Haptics.selectionAsync();
      }
      setHint((h) => (h === update.hint ? h : update.hint));
      if (update.phase === 3) finish();
    },
    [tracker, finish],
  );

  const onCaptured = useCallback(
    (event: { nativeEvent: NativeFaceCrop & { request: number } }) => {
      captureRef.current = event.nativeEvent;
      finish();
    },
    [finish],
  );

  // Le modèle SFace (~37 Mo) se charge pendant la capture plutôt qu'après.
  useEffect(() => {
    getSfaceSession().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (phase !== 2) {
      setBlinkSlow(false);
      return;
    }
    const timer = setTimeout(() => setBlinkSlow(true), BLINK_NUDGE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const accent = phase >= 3 ? "#30D158" : "#0A84FF";
  const title = t.livePhases[phase] ?? t.livePhases[0];
  const sub = phase < 3 && hint ? t.selfieHints[hint] : phase === 2 && blinkSlow ? t.selfieBlinkNudge : (t.livePhaseSub[phase] ?? "");
  const CaptureView = FaceCaptureView!;

  return (
    <View style={[styles.screen, { backgroundColor: demo.colors.screenDark }]}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{t.selfieNav}</Text>
        <Pressable onPress={() => demo.completeSelfie(null)}>
          <Text style={styles.navSkip}>{t.selfieSkip}</Text>
        </Pressable>
      </View>

      <View style={styles.viewfinderWrap}>
        <View style={styles.viewfinder}>
          {permission?.granted ? (
            <CaptureView
              style={StyleSheet.absoluteFill}
              active={phase < 3}
              captureRequest={captureRequest}
              onFaceFrame={onFaceFrame}
              onCaptured={onCaptured}
            />
          ) : (
            <Pressable onPress={permission?.canAskAgain === false ? () => Linking.openSettings() : requestPermission} style={styles.permission}>
              <Text style={styles.permissionText}>{t.mrzCameraPermission}</Text>
            </Pressable>
          )}
        </View>
        <Svg width={VIEWFINDER_W} height={VIEWFINDER_H} viewBox={`0 0 ${VIEWFINDER_W} ${VIEWFINDER_H}`} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d="M2 74V44A42 42 0 0 1 44 2h30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M142 2h30a42 42 0 0 1 42 42v30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M214 206v30a42 42 0 0 1-42 42h-30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M74 278H44a42 42 0 0 1-42-42v-30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
        </Svg>
        {phase >= 3 ? (
          <View style={styles.validationWrap} pointerEvents="none">
            <PopIn>
              <BlurView intensity={30} tint="light" style={styles.validationDisc}>
                <BigCheckIcon />
              </BlurView>
            </PopIn>
          </View>
        ) : null}
      </View>

      <View style={styles.dotsRow}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: phase > i ? "#30D158" : phase === i ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.25)" }]}
          />
        ))}
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t.selfieNote}</Text>
      </View>
    </View>
  );
}

type ActiveStage =
  | { kind: "align" }
  | { kind: "fetching" }
  | { kind: "challenge" }
  | { kind: "capture" }
  | { kind: "passed" }
  | { kind: "failed"; message: string }
  | { kind: "error"; message: string };

/** Délai laissé pour un selfie de face au repos après le défi, avant de prendre l'image telle quelle. */
const NEUTRAL_CAPTURE_WAIT_MS = 2500;
/** Sans image de visage suivi dans ce délai après le défi : échec (visage sorti du champ). */
const CAPTURE_TIMEOUT_MS = 6000;
/** Visage de face et au repos pendant ce temps avant de demander le défi au serveur. */
const ALIGN_HOLD_MS = 700;

function ActiveSelfie({ demo, onFallback }: { demo: AuthentikDemo; onFallback: (note: string) => void }) {
  const t = demo.t;
  const a = t.active;
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStageState] = useState<ActiveStage>({ kind: "align" });
  const [tracked, setTracked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [light, setLight] = useState<{ r: number; g: number; b: number } | null>(null);
  const [lockCamera, setLockCamera] = useState(false);
  const [captureRequest, setCaptureRequest] = useState(0);
  const stageRef = useRef<ActiveStage>({ kind: "align" });
  const recorderRef = useRef<ActiveLivenessRecorder | null>(null);
  const alignSinceRef = useRef<number | null>(null);
  const captureStartedRef = useRef(0);
  const captureAskedRef = useRef(false);
  const captureRef = useRef<LivenessCaptureEvent | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const setStage = useCallback((next: ActiveStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    getSfaceSession().catch(() => undefined);
  }, []);

  const restart = useCallback(() => {
    clearTimers();
    recorderRef.current = null;
    alignSinceRef.current = null;
    captureAskedRef.current = false;
    captureRef.current = null;
    setLight(null);
    setLockCamera(false);
    setStage({ kind: "align" });
  }, [clearTimers, setStage]);

  const startChallenge = useCallback(async () => {
    const backend = demo.backend;
    if (!backend) return;
    setStage({ kind: "fetching" });
    try {
      const issued = await requestLivenessChallenge(backend);
      if (stageRef.current.kind !== "fetching") return; // annulé entre-temps
      const recorder = new ActiveLivenessRecorder(issued);
      recorderRef.current = recorder;
      // Couleurs du défi lumineux affichées à leur heure exacte (horloge serveur → téléphone).
      const sequence = issued.challenge.lightSequence ?? [];
      setLockCamera(sequence.length > 0);
      for (const step of sequence) {
        const at = issued.challenge.issuedAt + step.atMs - recorder.clockOffsetMs;
        timersRef.current.push(setTimeout(() => setLight(step.color), Math.max(0, at - Date.now())));
      }
      if (sequence.length > 0) {
        const off = challengeEndsAt(issued.challenge) - recorder.clockOffsetMs;
        timersRef.current.push(setTimeout(() => setLight(null), Math.max(0, off - Date.now())));
      }
      void Haptics.selectionAsync();
      setStage({ kind: "challenge" });
    } catch (error) {
      if (stageRef.current.kind === "fetching") setStage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [demo.backend, setStage]);

  // Horloge d'affichage des consignes et des échéances (défi, puis selfie).
  useEffect(() => {
    if (stage.kind !== "challenge" && stage.kind !== "capture") return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      const recorder = recorderRef.current;
      if (!recorder) return;
      if (stageRef.current.kind === "challenge" && recorder.toServerTime(current) > challengeEndsAt(recorder.challenge)) {
        captureStartedRef.current = current;
        setLight(null);
        setLockCamera(false);
        setStage({ kind: "capture" });
      } else if (stageRef.current.kind === "capture") {
        const waited = current - captureStartedRef.current;
        if (!captureAskedRef.current && waited > NEUTRAL_CAPTURE_WAIT_MS) {
          captureAskedRef.current = true;
          setCaptureRequest((n) => n + 1);
        }
        if (waited > CAPTURE_TIMEOUT_MS) setStage({ kind: "failed", message: t.selfieHints["no-face"] });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [stage.kind, setStage, t]);

  const onLivenessFrame = useCallback(
    (event: { nativeEvent: LivenessFrameEvent }) => {
      const frame = event.nativeEvent;
      setTracked((was) => (was === frame.tracked ? was : frame.tracked));
      const current = stageRef.current.kind;
      if (current === "align") {
        if (!isNeutralFrontal(frame)) {
          alignSinceRef.current = null;
        } else if (alignSinceRef.current === null) {
          alignSinceRef.current = Date.now();
        } else if (Date.now() - alignSinceRef.current > ALIGN_HOLD_MS) {
          alignSinceRef.current = null;
          void startChallenge();
        }
      } else if (current === "challenge") {
        recorderRef.current?.push(frame);
      } else if (current === "capture" && !captureAskedRef.current && isNeutralFrontal(frame)) {
        captureAskedRef.current = true;
        setCaptureRequest((n) => n + 1);
      }
    },
    [startChallenge],
  );

  const onCaptured = useCallback(
    (event: { nativeEvent: LivenessCaptureEvent }) => {
      const recorder = recorderRef.current;
      if (stageRef.current.kind !== "capture" || !recorder) return;
      const capture = event.nativeEvent;
      captureRef.current = capture;
      const outcome = recorder.finish(Date.now() + recorder.clockOffsetMs);
      if (__DEV__) {
        console.log(`[VIVACITÉ] ${outcome.submission.samples.length} images · ${outcome.check.passed ? "réussi" : outcome.check.reasons.join(", ") || "étapes manquées"}`);
      }
      if (outcome.trackingInterrupted || (outcome.anchorId !== null && outcome.anchorId !== capture.anchorId)) {
        setStage({ kind: "failed", message: a.interrupted });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (failedBeyondLight(outcome.check)) {
        setStage({ kind: "failed", message: describeLivenessFailure(outcome.check, demo.lang) });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      // Seul le canal lumineux (non calibré sur appareil) a échoué : le serveur en décide.
      setStage({ kind: "passed" });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const active = { submission: outcome.submission, clockOffsetMs: recorder.clockOffsetMs };
      setTimeout(() => demo.completeSelfie(capture, { active }), DONE_DELAY_MS);
    },
    [a, demo, setStage],
  );

  const onSessionError = useCallback(
    (event: { nativeEvent: { message: string } }) => {
      clearTimers();
      setStage({ kind: "error", message: event.nativeEvent.message });
    },
    [clearTimers, setStage],
  );

  const recorder = recorderRef.current;
  const challenge = recorder?.challenge;
  const serverNow = recorder ? recorder.toServerTime(now) : 0;
  const phase = challenge && stage.kind === "challenge" ? challengePhaseAt(challenge, serverNow) : null;
  const lightOn = stage.kind === "challenge" && light !== null && challenge !== undefined && lightColorAt(challenge, serverNow) !== null;
  const fill = (template: string, action: keyof typeof a.actions) => template.replace("{action}", a.actions[action]);

  let title = a.align;
  let sub = tracked ? a.alignSub : t.selfieHints["no-face"];
  if (stage.kind === "fetching") {
    title = a.fetching;
    sub = "";
  } else if (phase?.kind === "lead") {
    title = `${a.ready} · ${Math.ceil(phase.remainingMs / 1000)}`;
    sub = fill(a.firstAction, phase.next);
  } else if (phase?.kind === "step") {
    title = a.actions[phase.action];
    sub = lightOn ? a.lightSub : a.actionSub;
  } else if (phase?.kind === "gap") {
    title = a.back;
    sub = fill(a.nextAction, phase.next);
  } else if (stage.kind === "challenge" || stage.kind === "capture") {
    title = a.capture;
    sub = a.captureSub;
  } else if (stage.kind === "passed") {
    title = a.passed;
    sub = a.passedSub;
  } else if (stage.kind === "failed") {
    title = a.failed;
    sub = stage.message;
  } else if (stage.kind === "error") {
    title = a.unavailable;
    sub = stage.message;
  }

  const stepCount = challenge?.steps.length ?? 3;
  const doneSteps =
    stage.kind === "passed" || stage.kind === "capture"
      ? stepCount
      : phase?.kind === "step"
        ? phase.index
        : phase?.kind === "gap"
          ? phase.nextIndex
          : 0;
  const accent = stage.kind === "passed" ? "#30D158" : stage.kind === "failed" || stage.kind === "error" ? "#FF9F0A" : "#0A84FF";
  const background = lightOn && light ? `rgb(${Math.round(light.r * 255)},${Math.round(light.g * 255)},${Math.round(light.b * 255)})` : demo.colors.screenDark;
  const LivenessView = FaceLivenessView!;
  const cameraOn = stage.kind === "align" || stage.kind === "fetching" || stage.kind === "challenge" || stage.kind === "capture";

  return (
    <View style={[styles.screen, { backgroundColor: background }]}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{a.nav}</Text>
        <Pressable onPress={() => demo.completeSelfie(null, { note: a.noteSkipped })}>
          <Text style={styles.navSkip}>{t.selfieSkip}</Text>
        </Pressable>
      </View>

      <View style={styles.viewfinderWrap}>
        <View style={styles.viewfinder}>
          {permission?.granted ? (
            <LivenessView
              style={StyleSheet.absoluteFill}
              active={cameraOn}
              captureRequest={captureRequest}
              lockCamera={lockCamera}
              onLivenessFrame={onLivenessFrame}
              onCaptured={onCaptured}
              onSessionError={onSessionError}
            />
          ) : (
            <Pressable onPress={permission?.canAskAgain === false ? () => Linking.openSettings() : requestPermission} style={styles.permission}>
              <Text style={styles.permissionText}>{t.mrzCameraPermission}</Text>
            </Pressable>
          )}
        </View>
        <Svg width={VIEWFINDER_W} height={VIEWFINDER_H} viewBox={`0 0 ${VIEWFINDER_W} ${VIEWFINDER_H}`} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d="M2 74V44A42 42 0 0 1 44 2h30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M142 2h30a42 42 0 0 1 42 42v30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M214 206v30a42 42 0 0 1-42 42h-30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M74 278H44a42 42 0 0 1-42-42v-30" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" />
        </Svg>
        {stage.kind === "passed" ? (
          <View style={styles.validationWrap} pointerEvents="none">
            <PopIn>
              <BlurView intensity={30} tint="light" style={styles.validationDisc}>
                <BigCheckIcon />
              </BlurView>
            </PopIn>
          </View>
        ) : null}
      </View>

      <View style={styles.dotsRow}>
        {Array.from({ length: stepCount }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: doneSteps > i ? "#30D158" : doneSteps === i && phase ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.25)" }]}
          />
        ))}
      </View>

      <View style={[styles.promptBox, lightOn ? styles.promptBoxOnLight : null]}>
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.subActive}>{sub}</Text> : null}
      </View>

      {stage.kind === "failed" || stage.kind === "error" ? (
        <View style={styles.actions}>
          <Pressable onPress={restart} style={[styles.actionButton, styles.actionPrimary]}>
            <Text style={styles.actionPrimaryText}>{a.retry}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              clearTimers();
              if (stage.kind === "failed" && captureRef.current) {
                demo.completeSelfie(captureRef.current, { note: a.noteFailed });
              } else {
                onFallback(stage.kind === "failed" ? a.noteFailed : a.noteUnavailable);
              }
            }}
            style={styles.actionButton}
          >
            <Text style={styles.actionSecondaryText}>{stage.kind === "failed" ? a.continueWithout : a.simpleSelfie}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginBottom: "auto" }} />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t.selfieNote}</Text>
      </View>
    </View>
  );
}

function DemoSelfie({ demo }: { demo: AuthentikDemo }) {
  return (
    <View style={[styles.screen, { backgroundColor: demo.colors.screenDark }]}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{demo.t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{demo.t.selfieNav}</Text>
        <View style={{ width: 52 }} />
      </View>

      <View style={styles.viewfinderWrap}>
        <View style={styles.viewfinder}>
          {/* radial-gradient(circle at 50% 38%, #25262B 0%, #141417 72%) — voir
              eMRTD Verify Mobile.dc.html l.406. Rayon = distance au coin le plus éloigné du centre
              (216x280, centre à 50%/38% => coin le plus éloigné à ~204.5px), comme le fait CSS par
              défaut pour un radial-gradient sans mot-clé d'étendue explicite. */}
          <Svg width={VIEWFINDER_W} height={VIEWFINDER_H} style={StyleSheet.absoluteFillObject}>
            <Defs>
              <RadialGradient id="viewfinderGrad" cx={108} cy={106.4} r={205} gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#25262B" />
                <Stop offset="72%" stopColor="#141417" />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={VIEWFINDER_W} height={VIEWFINDER_H} fill="url(#viewfinderGrad)" />
          </Svg>
          <Sweep />
          <Breathe>
            <Text style={styles.cameraLabel}>flux caméra avant</Text>
          </Breathe>
        </View>
        <Svg width={VIEWFINDER_W} height={VIEWFINDER_H} viewBox={`0 0 ${VIEWFINDER_W} ${VIEWFINDER_H}`} style={StyleSheet.absoluteFill}>
          <Path d="M2 74V44A42 42 0 0 1 44 2h30" stroke={demo.liveAccent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M142 2h30a42 42 0 0 1 42 42v30" stroke={demo.liveAccent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M214 206v30a42 42 0 0 1-42 42h-30" stroke={demo.liveAccent} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M74 278H44a42 42 0 0 1-42-42v-30" stroke={demo.liveAccent} strokeWidth={4} strokeLinecap="round" fill="none" />
        </Svg>
        {demo.liveDone ? (
          <View style={styles.validationWrap}>
            <PopIn>
              <BlurView intensity={30} tint="light" style={styles.validationDisc}>
                <BigCheckIcon />
              </BlurView>
            </PopIn>
          </View>
        ) : null}
      </View>

      <View style={styles.dotsRow}>
        {demo.liveDots.map((d, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: d.bg }]} />
        ))}
      </View>

      <Text style={styles.title}>{demo.liveTitle}</Text>
      <Text style={styles.sub}>{demo.liveSub}</Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{demo.t.selfieNote}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenDark, alignItems: "center", paddingHorizontal: 20, paddingTop: 6 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", paddingVertical: 2, paddingBottom: 20 },
  navCancel: { color: "rgba(255,255,255,0.8)", fontSize: 15 },
  navTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  navSkip: { color: "rgba(255,255,255,0.8)", fontSize: 15, minWidth: 52, textAlign: "right" },
  permission: { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", padding: 18 },
  permissionText: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center", lineHeight: 18 },
  viewfinderWrap: { width: VIEWFINDER_W, height: VIEWFINDER_H, alignItems: "center", justifyContent: "center" },
  viewfinder: { ...StyleSheet.absoluteFillObject, borderRadius: 42, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  sweep: { position: "absolute", left: 0, right: 0, height: 62, backgroundColor: "rgba(10,132,255,0.22)" },
  cameraLabel: { fontFamily: "Menlo", fontSize: 11, color: "rgba(255,255,255,0.28)" },
  validationWrap: { position: "absolute", alignItems: "center", justifyContent: "center" },
  validationDisc: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(48,209,88,0.16)", overflow: "hidden" },
  dotsRow: { flexDirection: "row", gap: 7, marginTop: 26 },
  dot: { width: 28, height: 4, borderRadius: 2 },
  title: { fontSize: 21, fontWeight: "600", color: "#fff", marginTop: 22, marginBottom: 7, textAlign: "center", letterSpacing: -0.3 },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.55)", textAlign: "center", marginBottom: "auto", lineHeight: 20 },
  promptBox: { alignItems: "center", paddingHorizontal: 14, paddingBottom: 4, borderRadius: 18, marginTop: 4 },
  promptBoxOnLight: { backgroundColor: "rgba(0,0,0,0.55)", paddingTop: 2, paddingBottom: 12 },
  subActive: { fontSize: 14, color: "rgba(255,255,255,0.7)", textAlign: "center", lineHeight: 20 },
  actions: { width: "100%", gap: 10, marginTop: 22, marginBottom: "auto" },
  actionButton: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  actionPrimary: { backgroundColor: "#0A84FF" },
  actionPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  actionSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: 16 },
  footer: { width: "100%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 13, paddingHorizontal: 15, marginBottom: 22 },
  footerText: { fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 18 },
});
