/**
 * Lecture MRZ — transcrit depuis le handoff, bloc `isMrz`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 299-317, README §6.2).
 * Le flux caméra réel n'est pas branché dans ce premier PoC (voir README du handoff §2 et §3 :
 * le prototype lui-même simule la caméra par un aplat texturé portant la mention « flux caméra »).
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { colors, fontMono } from "../theme";
import type { AuthentikDemo } from "../state";

function Spinner() {
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [rotate]);
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]} />;
}

export function MrzScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <View style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{demo.t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{demo.t.mrzTitle}</Text>
        <View style={{ width: 52 }} />
      </View>

      <View style={styles.cameraZone}>
        <Text style={styles.cameraLabel}>flux caméra</Text>
        <View style={styles.mrzBand}>
          <Text style={styles.mrzText}>{"P<FRAMARTIN<<CAMILLE<ELISE<<<<<<<<<<<<<<<<<\n21FR345679FRA9104125F3108304<<<<<<02"}</Text>
        </View>
      </View>

      <Text style={styles.title}>{demo.t.mrzHead}</Text>
      <Text style={styles.hint}>{demo.t.mrzHint}</Text>

      <View style={styles.footer}>
        <Spinner />
        <Text style={styles.footerText}>{demo.t.mrzReading}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenDark, paddingHorizontal: 20 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, paddingBottom: 18 },
  navCancel: { color: "#fff", fontSize: 15 },
  navTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cameraZone: { borderRadius: 16, overflow: "hidden", backgroundColor: "#1C1C1E", height: 230, justifyContent: "flex-end" },
  cameraLabel: { position: "absolute", alignSelf: "center", top: "42%", fontFamily: fontMono, fontSize: 11, color: "rgba(255,255,255,0.35)" },
  mrzBand: {
    marginBottom: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(10,132,255,0.14)",
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.accent,
  },
  mrzText: { fontFamily: fontMono, fontSize: 12, lineHeight: 20, color: "#fff", letterSpacing: 0.5 },
  title: { color: "#fff", fontSize: 19, fontWeight: "600", marginTop: 26, marginBottom: 6, lineHeight: 24 },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  footer: {
    marginTop: "auto",
    marginBottom: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 13,
    paddingHorizontal: 15,
  },
  spinner: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" },
  footerText: { color: "#fff", fontSize: 14 },
});
