/**
 * Écran d'accueil — transcrit depuis le handoff de design, bloc `isHome`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 198-296, et README §6.1).
 * Contrainte de design tenue volontairement : cet écran ne défile PAS (voir README §13.6).
 */
import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, Image, StyleSheet, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";
import { colors, radius, fontMono, type PaletteColors } from "../theme";
import { NfcIcon, PassportGlyph, IdCardGlyph, ResidencePermitGlyph, SunIcon, MoonIcon } from "../icons";
import type { AuthentikDemo } from "../state";

const HEADER_ILLUSTRATION = require("../../../assets/authentik/header-illustration.png");

const GLYPHS = [PassportGlyph, IdCardGlyph, ResidencePermitGlyph];

function WaveRing({ ringStyle }: { ringStyle: object }) {
  const scale = useRef(new Animated.Value(0.55)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.5, duration: 2600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 2600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[ringStyle, { transform: [{ scale }], opacity }]}
    />
  );
}

function ModeSwitch({
  online,
  onToggle,
  trackStyle,
  thumbStyle,
}: {
  online: boolean;
  onToggle: () => void;
  trackStyle: object;
  thumbStyle: object;
}) {
  const shift = useRef(new Animated.Value(online ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shift, { toValue: online ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [online, shift]);
  const translateX = shift.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: online }}
      style={[trackStyle, { backgroundColor: online ? colors.switchTrackActive : colors.switchTrackInactive }]}
    >
      <Animated.View style={[thumbStyle, { transform: [{ translateX }] }]} />
    </Pressable>
  );
}

export function HomeScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.appName}>{demo.t.appName}</Text>
          <Text style={styles.appSub}>{demo.homeSub}</Text>
        </View>
        <Pressable
          onPress={demo.toggleScheme}
          style={styles.themeToggle}
          accessibilityRole="button"
          accessibilityLabel={demo.scheme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
        >
          {demo.scheme === "dark" ? <SunIcon size={18} color={demo.colors.inkSecondary} /> : <MoonIcon size={18} color={demo.colors.inkSecondary} />}
        </Pressable>
        <Image source={HEADER_ILLUSTRATION} style={styles.headerImage} resizeMode="contain" />
      </View>

      <View style={styles.modeCard}>
        <View style={styles.modeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>{demo.modeLabel}</Text>
            <Text style={styles.modeDesc}>{demo.modeDesc}</Text>
          </View>
          <ModeSwitch online={demo.online} onToggle={demo.toggleOnline} trackStyle={styles.switchTrack} thumbStyle={styles.switchThumb} />
        </View>
        <Pressable onPress={demo.goCountries} style={styles.trustRow}>
          <View style={[styles.dot8, { backgroundColor: demo.modeDot }]} />
          <Text style={styles.trustLine} numberOfLines={1}>
            {demo.trustLineNow}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <View style={styles.scanRow}>
        <Pressable onPress={demo.startScan} style={styles.scanButtonWrap}>
          <WaveRing ringStyle={styles.waveRing} />
          <View style={styles.scanButtonShadow}>
            <View style={styles.scanButton}>
              {/* radial-gradient(120% 120% at 32% 22%, #3AA0FF 0%, #0A84FF 46%, #0060DF 100%)
                  — voir eMRTD Verify Mobile.dc.html l.233. expo-linear-gradient ne fait pas de
                  radial (voir README §"Fidélité connue") ; react-native-svg le peut nativement. */}
              <Svg width={146} height={146} style={StyleSheet.absoluteFillObject}>
                <Defs>
                  <RadialGradient id="scanGrad" cx="32%" cy="22%" r="120%">
                    <Stop offset="0%" stopColor={colors.gradientTop} />
                    <Stop offset="46%" stopColor={colors.gradientMid} />
                    <Stop offset="100%" stopColor={colors.gradientBottom} />
                  </RadialGradient>
                </Defs>
                <Rect x={0} y={0} width={146} height={146} rx={73} ry={73} fill="url(#scanGrad)" />
              </Svg>
              <NfcIcon size={40} color="#fff" strokeWidth={1.7} />
              <Text style={styles.scanLabel}>{demo.t.verifyBtn}</Text>
            </View>
          </View>
        </Pressable>
      </View>
      <Text style={styles.autoDetect}>{demo.t.autoDetect}</Text>

      <Text style={styles.sectionTitle}>{demo.t.supportedTitle}</Text>
      <View style={styles.grid}>
        {demo.supported.map((doc, i) => {
          const Glyph = GLYPHS[i];
          return (
            <View key={doc.name} style={styles.docCard}>
              <Glyph />
              <View style={{ alignItems: "center" }}>
                <Text style={styles.docName}>{doc.name}</Text>
                <Text style={styles.docFormat}>{doc.format}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.ephemeral}>{demo.t.ephemeral}</Text>
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4, marginBottom: 14 },
  headerText: { flex: 1, minWidth: 0 },
  appName: { fontSize: 30, fontWeight: "700", letterSpacing: -0.9, color: colors.inkPrimary, lineHeight: 33 },
  appSub: { fontSize: 14, color: colors.inkSecondary, marginTop: 2, lineHeight: 18 },
  headerImage: { width: 80, height: 80, marginRight: -6, marginBottom: -8 },
  themeToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  modeCard: { backgroundColor: colors.surface, borderRadius: radius.cardLg, overflow: "hidden", marginBottom: 10 },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 11, paddingHorizontal: 15 },
  modeLabel: { fontSize: 15, fontWeight: "600", color: colors.inkPrimary },
  modeDesc: { fontSize: 11.5, color: colors.inkSecondary, marginTop: 2, lineHeight: 15 },
  switchTrack: { width: 51, height: 31, borderRadius: 16, padding: 2, justifyContent: "center" },
  switchThumb: {
    width: 27,
    height: 27,
    borderRadius: 13.5,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  dot8: { width: 8, height: 8, borderRadius: 4 },
  trustLine: { flex: 1, fontSize: 13, color: `rgba(${colors.inkBaseRgb},0.75)` },
  chevron: { color: colors.chevron, fontSize: 20 },
  scanRow: { alignItems: "center", paddingVertical: 12 },
  scanButtonWrap: { width: 146, height: 146, alignItems: "center", justifyContent: "center" },
  waveRing: {
    position: "absolute",
    width: 146 + 28,
    height: 146 + 28,
    borderRadius: (146 + 28) / 2,
    borderWidth: 1.5,
    borderColor: "rgba(10,132,255,0.28)",
  },
  // Le dégradé lui-même ne peut pas porter d'ombre "efficace" (pas de backgroundColor uni) —
  // l'ombre est donc portée par ce wrapper opaque (entièrement recouvert par le dégradé),
  // ce qui évite l'avertissement de performance "cannot calculate shadow efficiently".
  scanButtonShadow: {
    width: 146,
    height: 146,
    borderRadius: 73,
    backgroundColor: colors.gradientMid,
    shadowColor: colors.accent,
    shadowOpacity: 0.34,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  scanButton: {
    width: 146,
    height: 146,
    borderRadius: 73,
    alignItems: "center",
    justifyContent: "center",
  },
  scanLabel: { color: "#fff", fontSize: 17, fontWeight: "600", marginTop: 9, letterSpacing: -0.2 },
  autoDetect: { textAlign: "center", fontSize: 12.5, color: colors.inkSecondary, marginHorizontal: 22, marginTop: 8, marginBottom: 14, lineHeight: 17 },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, color: colors.inkSecondary, textTransform: "uppercase", marginBottom: 7, marginLeft: 4 },
  grid: { flexDirection: "row", gap: 9 },
  docCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 7 },
  docName: { fontSize: 12, fontWeight: "600", color: colors.inkPrimary, textAlign: "center", lineHeight: 15 },
  docFormat: { fontSize: 10.5, color: colors.inkTertiary, marginTop: 4, fontFamily: fontMono },
  ephemeral: { fontSize: 13, color: colors.inkSecondary, marginHorizontal: 4, marginTop: 12, marginBottom: 104, lineHeight: 19 },
});
