/**
 * Verdict — transcrit depuis le handoff, bloc `isVerdict`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 449-517, README §6.7).
 * "Décisions de design à ne pas défaire" (README §13) : trois verdicts (pas deux), des disques de
 * couleur (pas de pastilles à icône) pour les cinq contrôles, session éphémère rappelée en pied.
 * Design v2 : les cinq lignes de contrôle apparaissent l'une après l'autre (`rowIn`, 0,45 s,
 * décalage 0,2 s + 70 ms par ligne) pendant le fondu d'entrée du verdict.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { fontMono, radius, type PaletteColors } from "../theme";
import { Icon, ShareIcon } from "../icons";
import type { AuthentikDemo } from "../state";

const ROW_IN = Easing.bezier(0.2, 0.8, 0.2, 1);

function RowIn({ index, style, children }: { index: number; style: object; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 450, delay: 200 + index * 70, easing: ROW_IN, useNativeDriver: true }).start();
  }, [index, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

export function VerdictScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 16 }}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navClose}>‹ {demo.t.close}</Text>
        </Pressable>
        <Pressable onPress={demo.openShare} accessibilityLabel={demo.t.share}>
          <ShareIcon />
        </Pressable>
      </View>

      <View style={[styles.decisionCard, { backgroundColor: demo.decisionBg, borderColor: demo.decisionBorder }]}>
        <View style={styles.pillRow}>
          <View style={[styles.pillDot, { backgroundColor: demo.verdictColor }]} />
          <Text style={[styles.pillLabel, { color: demo.verdictChipInk }]}>
            {demo.verdictChipLabel} · {demo.scenarioLabel}
          </Text>
        </View>
        <Text style={styles.decisionTitle}>{demo.decisionTitle}</Text>
        <Text style={styles.decisionSub}>{demo.decisionSub}</Text>
        <Text style={styles.decisionScore}>{demo.passedLabel}</Text>
      </View>

      <View style={styles.identityCard}>
        <View style={styles.identityRow}>
          <View style={styles.thumbnail}>
            <Text style={styles.thumbnailLabel}>DG2</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.surname}>{demo.identitySurname}</Text>
            <Text style={styles.givenNames}>{demo.identityGivenNames}</Text>
            <Text style={styles.techLine}>{demo.identityTechLine}</Text>
          </View>
        </View>
      </View>

      <View style={styles.checksCard}>
        {demo.checkRows.map((c, i) => (
          <RowIn key={c.label} index={i} style={[styles.checkRow, i > 0 && styles.checkRowBorder]}>
            <View style={[styles.checkDot, { backgroundColor: c.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.checkLabel}>{c.label}</Text>
              <Text style={styles.checkDetail}>{c.detail}</Text>
            </View>
          </RowIn>
        ))}
      </View>

      <View style={styles.detailsCard}>
        <Pressable onPress={demo.goFields} style={styles.detailRow}>
          <Icon name="doc" size={21} />
          <Text style={styles.detailLabel}>{demo.t.tabFields}</Text>
          <Text style={styles.detailValue}>{demo.identityFieldsCount}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable onPress={demo.goChain} style={[styles.detailRow, styles.detailRowBorder]}>
          <Icon name="shield" size={21} />
          <Text style={styles.detailLabel}>{demo.t.tabChain}</Text>
          <Text style={styles.detailValue}>{demo.chainDetailValue}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable onPress={demo.goAnomalies} style={[styles.detailRow, styles.detailRowBorder]}>
          <Icon name="warn" size={21} />
          <Text style={styles.detailLabel}>{demo.t.tabAnomalies}</Text>
          <View style={[styles.badge, { backgroundColor: demo.verdictColor }]}>
            <Text style={styles.badgeText}>{demo.anomalyCount}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.verifiedLine}>{demo.verifiedLine}</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, paddingBottom: 14 },
  navClose: { color: colors.accent, fontSize: 15 },
  decisionCard: { borderWidth: 1, borderRadius: radius.verdictCard, padding: 18, paddingHorizontal: 19, marginBottom: 12 },
  pillRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 11 },
  pillDot: { width: 9, height: 9, borderRadius: 4.5 },
  pillLabel: { fontSize: 11.5, fontWeight: "600", letterSpacing: 0.7, textTransform: "uppercase" },
  decisionTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.6, color: colors.inkVerdict, lineHeight: 29 },
  decisionSub: { fontSize: 14, color: `rgba(${colors.inkBaseRgb},0.78)`, marginTop: 8, lineHeight: 20 },
  decisionScore: { fontSize: 12.5, fontWeight: "500", color: colors.inkSecondary, marginTop: 12 },
  identityCard: { backgroundColor: colors.surface, borderRadius: radius.verdictCard, padding: 18, marginBottom: 14 },
  identityRow: { flexDirection: "row", gap: 15, alignItems: "flex-start" },
  thumbnail: { width: 72, height: 92, borderRadius: radius.thumbnail, backgroundColor: colors.thumbnail, alignItems: "center", justifyContent: "flex-end", paddingBottom: 6 },
  thumbnailLabel: { fontFamily: fontMono, fontSize: 8, color: `rgba(${colors.inkBaseRgb},0.55)` },
  surname: { fontSize: 21, fontWeight: "700", letterSpacing: -0.4, color: colors.inkPrimary },
  givenNames: { fontSize: 17, color: colors.inkPrimary, marginTop: 1 },
  techLine: { fontFamily: fontMono, fontSize: 13, lineHeight: 19, color: colors.inkSecondary, marginTop: 9 },
  checksCard: { backgroundColor: colors.surface, borderRadius: radius.verdictCard, overflow: "hidden", marginBottom: 14 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 11, padding: 13, paddingHorizontal: 16 },
  checkRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  checkDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  checkLabel: { fontSize: 15, color: colors.inkPrimary, lineHeight: 19 },
  checkDetail: { fontSize: 12.5, color: colors.inkSecondary, marginTop: 3, lineHeight: 17 },
  detailsCard: { backgroundColor: colors.surface, borderRadius: radius.verdictCard, overflow: "hidden", marginBottom: 16 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: 14, paddingHorizontal: 16 },
  detailRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  detailLabel: { flex: 1, fontSize: 16, color: colors.inkPrimary },
  detailValue: { fontSize: 13, color: colors.inkTertiary, marginRight: 6, fontFamily: fontMono },
  chevron: { color: colors.chevron, fontSize: 20 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, marginRight: 6 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  verifiedLine: { fontFamily: fontMono, fontSize: 11.5, lineHeight: 17, color: colors.inkTertiary, marginHorizontal: 4, marginBottom: 22 },
});
