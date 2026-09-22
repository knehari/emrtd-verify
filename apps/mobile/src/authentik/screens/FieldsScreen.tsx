/**
 * Champs vérifiés — transcrit depuis le handoff, bloc `isFields`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 519-538, README §6.8).
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, fontMono, radius } from "../theme";
import type { AuthentikDemo } from "../state";

export function FieldsScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 24 }}>
      <Pressable onPress={demo.goVerdict} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.back}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.tabFields}</Text>
      <Text style={styles.sub}>{demo.t.fieldsSub}</Text>
      <View style={styles.card}>
        {demo.fieldRows.map((f, i) => (
          <View key={f.label} style={[styles.row, i > 0 && styles.rowBorder]}>
            <View style={styles.rowHead}>
              <Text style={styles.rowLabel}>{f.label}</Text>
              <Text style={[styles.rowState, { color: f.color }]}>OK</Text>
            </View>
            <Text style={styles.rowValue}>{f.value}</Text>
            <Text style={styles.rowChecks}>{f.checks}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 18, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.cardLg, overflow: "hidden" },
  row: { padding: 12, paddingHorizontal: 16 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  rowLabel: { flex: 1, fontSize: 12, color: colors.inkSecondary },
  rowState: { fontSize: 12, fontWeight: "600" },
  rowValue: { fontFamily: fontMono, fontSize: 16, fontWeight: "500", color: colors.inkPrimary, marginTop: 3 },
  rowChecks: { fontSize: 11, color: colors.inkTertiary, marginTop: 4, lineHeight: 15 },
});
