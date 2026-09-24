/**
 * Capture de vivacité — transcrit depuis le handoff, bloc `isSelfie`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 397-434, README §6.5).
 *
 * Mode réel (après une vraie lecture NFC) : caméra frontale dans le viseur (modules/face-kit),
 * séquence guidée cadrage → rotation de la tête → clignement (src/faceMatch/selfieLiveness.ts) ;
 * l'image de face capturée au cadrage part à la comparaison avec la photo de la puce
 * (`demo.completeSelfie`). Mode démo : l'animation d'origine du prototype.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { FaceCaptureView, type FaceFrame } from "../../../modules/face-kit";
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
  return demo.realSelfie && FaceCaptureView ? <RealSelfie demo={demo} /> : <DemoSelfie demo={demo} />;
}

const DONE_DELAY_MS = 700;
const BLINK_NUDGE_MS = 6000;

function RealSelfie({ demo }: { demo: AuthentikDemo }) {
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
    setTimeout(() => demo.completeSelfie(capture), DONE_DELAY_MS);
  }, [demo]);

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
  footer: { width: "100%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 13, paddingHorizontal: 15, marginBottom: 22 },
  footerText: { fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 18 },
});
