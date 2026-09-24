/**
 * Verdict — transcrit depuis le handoff, bloc `isVerdict`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 449-517, README §6.7).
 * "Décisions de design à ne pas défaire" (README §13) : trois verdicts (pas deux), des disques de
 * couleur (pas de pastilles à icône) pour les cinq contrôles, session éphémère rappelée en pied.
 * Design v2 : les cinq lignes de contrôle apparaissent l'une après l'autre (`rowIn`, 0,45 s,
 * décalage 0,2 s + 70 ms par ligne) pendant le fondu d'entrée du verdict.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Animated, Easing, Image } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { Flag } from "../components/Flag";
import { fontMono, radius, type PaletteColors } from "../theme";
import { Icon, ShareIcon } from "../icons";
import type { AuthentikDemo } from "../state";

const ROW_IN = Easing.bezier(0.2, 0.8, 0.2, 1);

function IdField({
  label,
  value,
  styles,
  strong,
  mono,
  narrow,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  strong?: boolean;
  mono?: boolean;
  narrow?: boolean;
}) {
  return (
    <View style={narrow ? styles.idFieldNarrow : styles.idField}>
      <Text style={styles.idFieldLabel}>{label}</Text>
      <Text style={[styles.idFieldValue, strong && styles.idFieldStrong, mono && styles.idFieldMono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

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

      {/* Carte au format pièce d'identité (ID-1) : bandeau pays, photo DG2, champs lus sur la puce. */}
      <View style={styles.idCard}>
        <View style={styles.idHeader}>
          <Flag code={demo.idCard.countryCode} width={26} height={18} />
          <Text style={styles.idCountry}>{demo.idCard.countryCode}</Text>
          <Text style={styles.idDocType} numberOfLines={1}>
            {demo.idCard.docTypeLabel}
          </Text>
          <View style={styles.idChip}>
            <View style={styles.idChipLine} />
            <View style={[styles.idChipLine, { top: 9 }]} />
          </View>
        </View>
        <View style={styles.idBody}>
          <View style={styles.idPhoto}>
            {demo.faceImageUri ? (
              // Photo DG2 lue sur la puce (JPEG ou JPEG 2000 — tous deux décodés nativement par iOS).
              <Image source={{ uri: demo.faceImageUri }} style={styles.idPhotoImage} resizeMode="cover" />
            ) : (
              <Text style={styles.thumbnailLabel}>DG2</Text>
            )}
          </View>
          <View style={styles.idFields}>
            <IdField label={demo.t.idCardLabels.surname} value={demo.idCard.surname} styles={styles} strong />
            <IdField label={demo.t.idCardLabels.givenNames} value={demo.idCard.givenNames} styles={styles} />
            <View style={styles.idPair}>
              <IdField label={demo.t.idCardLabels.birth} value={demo.idCard.birthDate} styles={styles} mono />
              <IdField label={demo.t.idCardLabels.sex} value={demo.idCard.sex} styles={styles} mono narrow />
            </View>
            <View style={styles.idPair}>
              <IdField label={demo.t.idCardLabels.nationality} value={demo.idCard.nationality} styles={styles} mono />
              <IdField label={demo.t.idCardLabels.expiry} value={demo.idCard.expiryDate} styles={styles} mono />
            </View>
          </View>
        </View>
        <View style={styles.idFooter}>
          <Text style={styles.idFieldLabel}>{demo.t.idCardLabels.number}</Text>
          <Text style={styles.idNumber} selectable>
            {demo.idCard.documentNumber}
          </Text>
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
  idCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    marginBottom: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  idHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: `rgba(${colors.inkBaseRgb},0.05)`,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  idCountry: { fontFamily: fontMono, fontSize: 14, fontWeight: "700", letterSpacing: 1, color: colors.inkPrimary },
  idDocType: { flex: 1, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", color: colors.inkSecondary },
  idChip: { width: 26, height: 19, borderRadius: 4, backgroundColor: "#C9A649", opacity: 0.9 },
  idChipLine: { position: "absolute", left: 3, right: 3, top: 5, height: 1, backgroundColor: "rgba(0,0,0,0.25)" },
  idBody: { flexDirection: "row", gap: 14, padding: 16, paddingBottom: 10 },
  idPhoto: {
    width: 88,
    height: 114,
    borderRadius: 8,
    backgroundColor: colors.thumbnail,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 6,
    overflow: "hidden",
  },
  idPhotoImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  idFields: { flex: 1, minWidth: 0, gap: 7 },
  idPair: { flexDirection: "row", gap: 10 },
  idField: { flex: 1, minWidth: 0 },
  idFieldNarrow: { width: 44 },
  idFieldLabel: { fontSize: 9.5, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", color: colors.inkSecondary },
  idFieldValue: { fontSize: 14, color: colors.inkPrimary, marginTop: 1 },
  idFieldStrong: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  idFieldMono: { fontFamily: fontMono, fontSize: 13.5 },
  idFooter: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  idNumber: { fontFamily: fontMono, fontSize: 16, fontWeight: "600", letterSpacing: 1.5, color: colors.inkPrimary },
  thumbnailLabel: { fontFamily: fontMono, fontSize: 8, color: `rgba(${colors.inkBaseRgb},0.55)` },
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
