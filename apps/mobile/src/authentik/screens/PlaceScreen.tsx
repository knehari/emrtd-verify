/**
 * Positionnement du document — transcrit depuis le handoff, bloc `isPlace`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 319-357, README §6.3).
 */
import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { type PaletteColors } from "../theme";
import { NfcIcon } from "../icons";
import type { AuthentikDemo } from "../state";

type PlaceStyles = ReturnType<typeof makeStyles>;

function TapGlow({ s }: { s: PlaceStyles }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1600),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0.75, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.5, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);
  return <Animated.View style={[s.tapGlow, { opacity, transform: [{ scale }] }]} />;
}

function SlidingDoc({ s }: { s: PlaceStyles }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 3600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);
  const translateX = progress.interpolate({ inputRange: [0, 0.22, 0.55, 1], outputRange: [52, 52, 0, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 0.22, 0.55, 1], outputRange: [26, 26, 0, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 0.22, 0.55, 1], outputRange: [0, 1, 1, 1] });
  return (
    <Animated.View style={[s.docCard, { transform: [{ translateX }, { translateY }], opacity }]}>
      <View style={s.docPhoto} />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={[s.docLine, { width: "100%" }]} />
        <View style={[s.docLine, { width: "72%" }]} />
        <View style={[s.docLine, { width: "56%", opacity: 0.65 }]} />
      </View>
    </Animated.View>
  );
}

export function PlaceScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <View style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{demo.t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{demo.t.placeNav}</Text>
        <View style={{ width: 52 }} />
      </View>

      <View style={styles.illustration}>
        <SlidingDoc s={styles} />
        <View style={styles.phone}>
          <View style={styles.phoneScreen}>
            <View style={styles.notch} />
            <TapGlow s={styles} />
            <View style={styles.nfcIconWrap}>
              <NfcIcon size={26} color="rgba(120,190,255,0.95)" strokeWidth={1.8} />
            </View>
            <View style={styles.antennaRule} />
            <Text style={styles.antennaLabel}>antenne NFC</Text>
          </View>
        </View>
      </View>

      <Text style={styles.title}>{demo.t.placeHead}</Text>
      <Text style={styles.hint}>{demo.t.placeHint}</Text>

      <View style={styles.tipsCard}>
        <View style={styles.tipRow}>
          <Text style={styles.bullet}>·</Text>
          <Text style={styles.tipText}>{demo.t.placeTip1}</Text>
        </View>
        <View style={[styles.tipRow, styles.tipRowBorder]}>
          <Text style={styles.bullet}>·</Text>
          <Text style={styles.tipText}>{demo.t.placeTip2}</Text>
        </View>
      </View>

      {demo.verificationError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{demo.verificationError.message}</Text>
        </View>
      ) : null}

      <Pressable onPress={demo.beginNfc} style={styles.cta}>
        <Text style={styles.ctaLabel}>{demo.t.placeCta}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, paddingBottom: 6 },
  navCancel: { color: colors.accent, fontSize: 15 },
  navTitle: { color: colors.inkPrimary, fontSize: 15, fontWeight: "600" },
  illustration: { height: 272, alignItems: "center", justifyContent: "center", marginTop: 6 },
  docCard: {
    position: "absolute",
    width: 116,
    height: 78,
    borderRadius: 12,
    backgroundColor: "#F3F5FA",
    borderWidth: 1,
    borderColor: "rgba(60,60,67,0.2)",
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    padding: 9,
    marginTop: -84,
    marginLeft: 86,
    shadowColor: "#0A2540",
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  docPhoto: { width: 26, height: 34, borderRadius: 3, backgroundColor: "rgba(10,132,255,0.16)" },
  docLine: { height: 4, borderRadius: 2, backgroundColor: "rgba(60,60,67,0.18)" },
  phone: { width: 118, height: 228, borderRadius: 24, backgroundColor: "#0B0B0C", padding: 5, shadowColor: "#0A2540", shadowOpacity: 0.24, shadowRadius: 34, shadowOffset: { width: 0, height: 16 } },
  phoneScreen: { flex: 1, borderRadius: 19, backgroundColor: "#1F2024", overflow: "hidden", alignItems: "center" },
  notch: { position: "absolute", top: 5, width: 34, height: 10, borderRadius: 6, backgroundColor: "#000" },
  nfcIconWrap: { marginTop: 40, alignItems: "center", justifyContent: "center" },
  tapGlow: { position: "absolute", top: 22, width: 62, height: 62, borderRadius: 31, backgroundColor: "rgba(10,132,255,0.22)" },
  antennaRule: { position: "absolute", top: 92, left: 14, right: 14, height: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  antennaLabel: { position: "absolute", top: 100, fontFamily: "Menlo", fontSize: 10, color: "rgba(255,255,255,0.6)" },
  title: { fontSize: 23, fontWeight: "700", letterSpacing: -0.5, color: colors.inkPrimary, marginTop: 14, marginBottom: 8, lineHeight: 28 },
  hint: { fontSize: 14, color: `rgba(${colors.inkBaseRgb},0.65)`, marginBottom: 16, lineHeight: 20 },
  tipsCard: { backgroundColor: colors.surface, borderRadius: 14, overflow: "hidden" },
  tipRow: { flexDirection: "row", gap: 10, padding: 12, paddingHorizontal: 15 },
  tipRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  bullet: { color: colors.accent, fontWeight: "700" },
  tipText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: `rgba(${colors.inkBaseRgb},0.8)` },
  errorBanner: {
    marginTop: 14,
    backgroundColor: "rgba(255,59,48,0.1)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.3)",
  },
  errorText: { color: "#D70015", fontSize: 13, lineHeight: 18 },
  cta: {
    marginTop: "auto",
    marginBottom: 24,
    backgroundColor: colors.accent,
    borderRadius: 15,
    paddingVertical: 17,
    alignItems: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.26,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  ctaLabel: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
