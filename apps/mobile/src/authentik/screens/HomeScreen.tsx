/**
 * Écran d'accueil — transcrit depuis le handoff de design, bloc `isHome`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 198-296, et README §6.1).
 * Contrainte de design tenue volontairement : cet écran ne défile PAS (voir README §13.6).
 */
import React, { useEffect, useRef } from "react";
import { View, Text, Image, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, fontMono } from "../theme";
import { NfcIcon, PassportGlyph, IdCardGlyph, ResidencePermitGlyph } from "../icons";
import type { AuthentikDemo } from "../state";

const HEADER_ILLUSTRATION = require("../../../assets/authentik/header-illustration.png");

const GLYPHS = [PassportGlyph, IdCardGlyph, ResidencePermitGlyph];

function WaveRing() {
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
      style={[styles.waveRing, { transform: [{ scale }], opacity }]}
    />
  );
}

function ModeSwitch({ online, onToggle }: { online: boolean; onToggle: () => void }) {
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
      style={[styles.switchTrack, { backgroundColor: online ? colors.switchTrackActive : colors.switchTrackInactive }]}
    >
      <Animated.View style={[styles.switchThumb, { transform: [{ translateX }] }]} />
    </Pressable>
  );
}

export function HomeScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.appName}>{demo.t.appName}</Text>
          <Text style={styles.appSub}>{demo.homeSub}</Text>
        </View>
        <Image source={HEADER_ILLUSTRATION} style={styles.headerImage} resizeMode="contain" />
      </View>

      <View style={styles.modeCard}>
        <View style={styles.modeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>{demo.modeLabel}</Text>
            <Text style={styles.modeDesc}>{demo.modeDesc}</Text>
          </View>
          <ModeSwitch online={demo.online} onToggle={demo.toggleOnline} />
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
          <WaveRing />
          <LinearGradient
            colors={[colors.gradientTop, colors.gradientMid, colors.gradientBottom]}
            start={{ x: 0.32, y: 0.05 }}
            end={{ x: 0.75, y: 0.95 }}
            locations={[0, 0.46, 1]}
            style={styles.scanButton}
          >
            <NfcIcon size={40} color="#fff" strokeWidth={1.7} />
            <Text style={styles.scanLabel}>{demo.t.verifyBtn}</Text>
          </LinearGradient>
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

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4, marginBottom: 14 },
  headerText: { flex: 1, minWidth: 0 },
  appName: { fontSize: 30, fontWeight: "700", letterSpacing: -0.9, color: colors.inkPrimary, lineHeight: 33 },
  appSub: { fontSize: 14, color: colors.inkSecondary, marginTop: 2, lineHeight: 18 },
  headerImage: { width: 80, height: 80, marginRight: -6, marginBottom: -8 },
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
  trustLine: { flex: 1, fontSize: 13, color: "rgba(60,60,67,0.75)" },
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
  scanButton: {
    width: 146,
    height: 146,
    borderRadius: 73,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.34,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
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
