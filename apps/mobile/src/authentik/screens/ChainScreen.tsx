/**
 * Chaîne de confiance PKI — transcrit depuis le handoff, bloc `isChain`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 540-563, README §6.9).
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { fontMono, type PaletteColors } from "../theme";
import type { AuthentikDemo } from "../state";

export function ChainScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 24 }}>
      <Pressable onPress={demo.goVerdict} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.back}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.tabChain}</Text>
      <Text style={styles.sub}>{demo.t.chainSub}</Text>
      {demo.chainRows.map((n) => (
        <View key={n.title} style={styles.nodeRow}>
          <View style={styles.timeline}>
            <View style={[styles.timelineDot, { backgroundColor: n.color }]} />
            <View style={[styles.timelineLine, { backgroundColor: n.isLast ? "transparent" : `rgba(${demo.colors.inkBaseRgb},0.2)` }]} />
          </View>
          <View style={styles.nodeCard}>
            <View style={styles.nodeHead}>
              <Text style={styles.nodeTitle}>{n.title}</Text>
              <Text style={[styles.nodeState, { color: n.color }]}>{n.state}</Text>
            </View>
            <Text style={styles.nodeSubject}>{n.subject}</Text>
            {"details" in n && Array.isArray(n.details) ? (
              <View style={styles.details}>
                {(n.details as { label: string; value: string }[]).map((d) => (
                  <View key={d.label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{d.label}</Text>
                    <Text style={styles.detailValue} selectable>
                      {d.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {n.note ? <Text style={styles.nodeNote}>{n.note}</Text> : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 20, lineHeight: 19 },
  nodeRow: { flexDirection: "row", gap: 13 },
  timeline: { alignItems: "center", width: 18 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 16 },
  timelineLine: { flex: 1, width: 1.5 },
  nodeCard: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: 14, padding: 13, paddingHorizontal: 15, marginBottom: 10 },
  nodeHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  nodeTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.inkPrimary },
  nodeState: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
  nodeSubject: { fontFamily: fontMono, fontSize: 12, lineHeight: 18, color: `rgba(${colors.inkBaseRgb},0.65)`, marginTop: 6 },
  details: { marginTop: 10, gap: 6 },
  detailRow: { gap: 1 },
  detailLabel: { fontSize: 10.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.inkSecondary },
  detailValue: { fontFamily: fontMono, fontSize: 11.5, lineHeight: 16, color: `rgba(${colors.inkBaseRgb},0.8)` },
  nodeNote: { fontSize: 12.5, color: colors.inkSecondary, marginTop: 7, lineHeight: 17 },
});
