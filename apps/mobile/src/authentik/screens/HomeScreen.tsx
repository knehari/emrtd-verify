/**
 * Écran d'accueil — design v2 (`Authentik Mobile v2 Dark.dc.html`, bloc `isHome`) :
 * - un seul cadre d'en-tête regroupe le logo flat + nom de l'app, le mode de vérification (switch
 *   hors ligne / en ligne) et la ligne d'état du magasin CSCA (→ pays pris en charge) ;
 * - le bouton Vérifier, en anneau de verre bleu autour d'un disque plein, occupe l'espace central
 *   (l'espace libre revient à cette zone, pour une répartition équilibrée) ;
 * - les documents pris en charge et la mention éphémère ferment l'écran, au-dessus du dock.
 * Reste dans un ScrollView (défilement demandé par l'utilisateur pour les petits écrans) ; sur un
 * iPhone 6,1" tout tient sans défiler. La bascule clair/sombre, qui était dans l'en-tête, est
 * désormais dans Réglages.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { radius, fontMono, type PaletteColors } from "../theme";
import { NfcIcon, AppIcon, PassportGlyph, IdCardGlyph, ResidencePermitGlyph } from "../icons";
import type { AuthentikDemo } from "../state";

const GLYPHS = [PassportGlyph, IdCardGlyph, ResidencePermitGlyph];
const RING = 176;
const DISC = 132;

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
  return <Animated.View pointerEvents="none" style={[ringStyle, { transform: [{ scale }], opacity }]} />;
}

/** Switch iOS 51 × 31 — mode hors ligne / en ligne ici, retours et apparence dans Réglages. */
export function ModeSwitch({
  on,
  onToggle,
  colors,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  colors: PaletteColors;
  label?: string;
}) {
  const shift = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shift, { toValue: on ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [on, shift]);
  const translateX = shift.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      style={[switchStyles.track, { backgroundColor: on ? colors.switchTrackActive : colors.switchTrackInactive }]}
    >
      <Animated.View style={[switchStyles.thumb, { transform: [{ translateX }] }]} />
    </Pressable>
  );
}

const switchStyles = StyleSheet.create({
  track: { width: 51, height: 31, borderRadius: 16, padding: 2, justifyContent: "center" },
  thumb: {
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
});

export function HomeScreen({ demo }: { demo: AuthentikDemo }) {
  const c = demo.colors;
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <View style={styles.brandRow}>
          <AppIcon size={48} />
          <View style={styles.brandText}>
            <Text style={styles.appName}>{demo.t.appName}</Text>
            <Text style={styles.appSub}>{demo.homeSub}</Text>
          </View>
        </View>
        <View style={[styles.modeRow, styles.rule]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.modeLabel}>{demo.modeLabel}</Text>
            <Text style={styles.modeDesc}>{demo.modeDesc}</Text>
          </View>
          <ModeSwitch on={demo.online} onToggle={demo.toggleOnline} colors={c} label={demo.t.modeTitle} />
        </View>
        <Pressable onPress={demo.goCountries} style={[styles.trustRow, styles.rule]}>
          <View style={[styles.dot8, { backgroundColor: demo.modeDot }]} />
          <Text style={styles.trustLine} numberOfLines={1}>
            {demo.trustLineNow}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <Pressable onPress={demo.startScan} accessibilityLabel={demo.t.verifyBtn} style={styles.ring}>
          <WaveRing ringStyle={styles.waveRing} />
          <View style={styles.disc}>
            <NfcIcon size={38} color="#fff" strokeWidth={1.8} />
            <Text style={styles.discLabel}>{demo.t.verifyBtn}</Text>
          </View>
        </Pressable>
        <Text style={styles.autoDetect}>{demo.t.autoDetect}</Text>
      </View>

      <View>
        <Text style={styles.sectionTitle}>{demo.t.supportedTitle}</Text>
        <View style={styles.grid}>
          {demo.supported.map((doc, i) => {
            const Glyph = GLYPHS[i];
            return (
              <View key={doc.name} style={styles.docCard}>
                <Glyph fill={c.glyphFill} inkRgb={c.inkBaseRgb} />
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
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 104, gap: 14 },
    headerCard: { backgroundColor: colors.surface, borderRadius: radius.verdictCard, overflow: "hidden" },
    rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 15 },
    brandText: { flex: 1, minWidth: 0 },
    appName: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5, color: colors.inkPrimary, lineHeight: 24 },
    appSub: { fontSize: 13, color: colors.inkSecondary, marginTop: 3, lineHeight: 17 },
    modeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 15 },
    modeLabel: { fontSize: 15, fontWeight: "600", color: colors.inkPrimary, lineHeight: 18 },
    modeDesc: { fontSize: 11.5, color: colors.inkSecondary, marginTop: 2, lineHeight: 15.5 },
    trustRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 15 },
    dot8: { width: 8, height: 8, borderRadius: 4 },
    trustLine: { flex: 1, fontSize: 13, color: `rgba(${colors.inkBaseRgb},0.75)` },
    chevron: { color: colors.chevron, fontSize: 20 },
    center: { flex: 1, minHeight: 236, alignItems: "center", justifyContent: "center", gap: 16 },
    // Anneau de verre : fond bleu à 10 %, liseré bleu 0,5 px (box-shadow 0 0 0 .5px du prototype).
    ring: {
      width: RING,
      height: RING,
      borderRadius: RING / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(10,132,255,0.1)",
      borderWidth: 0.5,
      borderColor: "rgba(10,132,255,0.35)",
    },
    waveRing: {
      position: "absolute",
      width: RING,
      height: RING,
      borderRadius: RING / 2,
      borderWidth: 1.5,
      borderColor: "rgba(10,132,255,0.4)",
    },
    // Disque plein ; le reflet haut (inset 0 1px 0 rgba(255,255,255,.3)) devient un liseré supérieur.
    disc: {
      width: DISC,
      height: DISC,
      borderRadius: DISC / 2,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: "rgba(255,255,255,0.3)",
      shadowColor: colors.accent,
      shadowOpacity: 0.38,
      shadowRadius: 34,
      shadowOffset: { width: 0, height: 14 },
      elevation: 10,
    },
    discLabel: { color: "#fff", fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
    autoDetect: { textAlign: "center", fontSize: 12.5, lineHeight: 17.5, color: colors.inkSecondary, maxWidth: 260 },
    sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, color: colors.inkSecondary, textTransform: "uppercase", marginBottom: 7, marginLeft: 4 },
    grid: { flexDirection: "row", gap: 9 },
    docCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 8, alignItems: "center", gap: 7 },
    docName: { fontSize: 12, fontWeight: "600", color: colors.inkPrimary, textAlign: "center", lineHeight: 15 },
    docFormat: { fontSize: 10.5, color: colors.inkTertiary, marginTop: 4, fontFamily: fontMono },
    ephemeral: { fontSize: 12.5, lineHeight: 18, color: `rgba(${colors.inkBaseRgb},0.55)`, marginTop: 12, marginHorizontal: 4 },
  });
