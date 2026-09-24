/**
 * Magasin de confiance — transcrit depuis le handoff, bloc `isTrust`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 586-608, README §6.11).
 * Le bouton "Synchroniser maintenant" est décoratif dans le prototype lui-même (aucun `onClick`
 * dans le handoff) — repris tel quel ici, sans action câblée.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { fontMono, radius, type PaletteColors } from "../theme";
import { Icon } from "../icons";
import type { AuthentikDemo } from "../state";

export function TrustScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 110 }}>
      <Pressable onPress={demo.reset} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.back}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.trustTitle}</Text>
      <Text style={styles.sub}>{demo.t.trustSub}</Text>

      <View style={styles.statsCard}>
        {demo.trustRows.map((r, i) => (
          <View key={r.label} style={[styles.statRow, i > 0 && styles.statRowBorder]}>
            <Text style={styles.statLabel}>{r.label}</Text>
            <Text style={styles.statValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={demo.goCountries} style={styles.countriesBtn}>
        <Icon name="globe" size={21} />
        <Text style={styles.countriesLabel}>{demo.t.countriesTitle}</Text>
        <Text style={styles.countriesCount}>{demo.countryRows.length}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <View style={styles.syncBtn}>
        <Text style={styles.syncLabel}>{demo.t.syncNow}</Text>
      </View>

      <Text style={styles.note}>{demo.t.trustNote}</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 18, lineHeight: 19 },
  statsCard: { backgroundColor: colors.surface, borderRadius: radius.cardLg, overflow: "hidden", marginBottom: 14 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, paddingHorizontal: 16 },
  statRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  statLabel: { flex: 1, fontSize: 15, color: colors.inkPrimary },
  statValue: { fontFamily: fontMono, fontSize: 13, fontWeight: "500", color: `rgba(${colors.inkBaseRgb},0.65)` },
  countriesBtn: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 12,
  },
  countriesLabel: { flex: 1, fontSize: 16, color: colors.inkPrimary },
  countriesCount: { fontFamily: fontMono, fontSize: 13, color: colors.inkTertiary },
  chevron: { color: colors.chevron, fontSize: 20 },
  syncBtn: { backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  syncLabel: { color: colors.accent, fontSize: 16 },
  note: { fontSize: 11.5, color: colors.inkTertiary, marginHorizontal: 4, marginTop: 14, lineHeight: 16 },
});
