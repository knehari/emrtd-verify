/**
 * Capture de vivacité — transcrit depuis le handoff, bloc `isSelfie`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 397-434, README §6.5).
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
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
