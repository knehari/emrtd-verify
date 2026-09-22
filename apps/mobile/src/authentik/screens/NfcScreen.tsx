/**
 * Lecture NFC — transcrit depuis le handoff, bloc `isNfc`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 359-395, README §6.4).
 * Pas d'anneau de progression (écarté explicitement au design, voir README §13.3) : pourcentage
 * géant + barre fine + journal DG.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { BlurView } from "expo-blur";
import { colors, fontMono } from "../theme";
import { NfcIcon, Icon } from "../icons";
import type { AuthentikDemo } from "../state";

function Wave() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.15, duration: 3000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 3000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);
  return <Animated.View style={[styles.waveRing, { transform: [{ scale }], opacity }]} />;
}

export function NfcScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <View style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{demo.t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{demo.t.nfcNav}</Text>
        <View style={{ width: 52 }} />
      </View>

      <View style={styles.center}>
        <View style={styles.halo} />
        <Wave />
        <View style={styles.nfcIconRow}>
          <NfcIcon size={26} color={colors.accent} strokeWidth={1.6} />
        </View>
        <View style={styles.pctRow}>
          <Text style={styles.pctNumber}>{demo.pct}</Text>
          <Text style={styles.pctSign}>%</Text>
        </View>
        <Text style={styles.protocol}>{demo.t.nfcProtocol} · AES-128</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${demo.pct}%` }]} />
      </View>

      <Text style={styles.title}>{demo.t.nfcHead}</Text>
      <Text style={styles.hint}>{demo.t.nfcHint}</Text>

      <BlurView intensity={40} tint="light" style={styles.dgCard}>
        {demo.dgRows.map((g, i) => (
          <View key={g.id} style={[styles.dgRow, i > 0 && styles.dgRowBorder]}>
            <Text style={[styles.dgId, { color: g.tone }]}>{g.id}</Text>
            <Text style={[styles.dgLabel, { color: g.tone }]}>{g.label}</Text>
            {g.state === "done" ? (
              <Icon name="check" size={19} color={g.markTone} strokeWidth={1.8} />
            ) : (
              <View style={[styles.dgDot, { borderColor: g.markTone, backgroundColor: g.state === "current" ? "transparent" : g.markTone }]} />
            )}
          </View>
        ))}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, paddingBottom: 6 },
  navCancel: { color: colors.accent, fontSize: 15 },
  navTitle: { color: colors.inkPrimary, fontSize: 15, fontWeight: "600" },
  center: { alignItems: "center", justifyContent: "center", height: 250 },
  halo: { position: "absolute", top: 18, width: 170, height: 170, borderRadius: 85, backgroundColor: "rgba(10,132,255,0.13)" },
  waveRing: { position: "absolute", top: 26, width: 154, height: 154, borderRadius: 77, borderWidth: 1, borderColor: "rgba(10,132,255,0.32)" },
  nfcIconRow: { marginTop: 22 },
  pctRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 20 },
  pctNumber: { fontSize: 76, fontWeight: "200", letterSpacing: -3.5, color: colors.nfcDigit },
  pctSign: { fontSize: 24, fontWeight: "300", color: "rgba(60,60,67,0.45)" },
  protocol: { fontFamily: fontMono, fontSize: 10.5, letterSpacing: 1.4, color: colors.inkTertiary, marginTop: 14 },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(60,60,67,0.12)", overflow: "hidden", marginHorizontal: 4, marginBottom: 22 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  title: { textAlign: "center", fontSize: 19, fontWeight: "600", color: colors.inkPrimary, marginHorizontal: 20, marginBottom: 6, lineHeight: 24 },
  hint: { textAlign: "center", fontSize: 14, color: colors.inkSecondary, marginHorizontal: 16, marginBottom: 18, lineHeight: 20 },
  dgCard: { borderRadius: 14, overflow: "hidden" },
  dgRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11, paddingHorizontal: 15 },
  dgRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(60,60,67,0.16)" },
  dgId: { fontFamily: fontMono, fontSize: 11, fontWeight: "600", width: 34 },
  dgLabel: { flex: 1, fontSize: 14 },
  dgDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
});
