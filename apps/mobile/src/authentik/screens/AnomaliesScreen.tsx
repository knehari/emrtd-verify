/**
 * Anomalies — transcrit depuis le handoff, bloc `isAnomalies`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 565-584, README §6.10).
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, fontMono, radius } from "../theme";
import { Icon } from "../icons";
import type { AuthentikDemo } from "../state";

export function AnomaliesScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 24 }}>
      <Pressable onPress={demo.goVerdict} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.back}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.tabAnomalies}</Text>
      <Text style={styles.sub}>{demo.t.anomSub}</Text>
      {demo.anomalyRows.map((a) => (
        <View key={a.code} style={styles.card}>
          <Icon name={a.sev === "info" ? "info" : "warn"} size={21} color={a.color} strokeWidth={1.7} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.head}>
              <Text style={styles.code}>{a.code}</Text>
              <Text style={[styles.sev, { color: a.color }]}>{a.sev}</Text>
            </View>
            <Text style={styles.message}>{a.message}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 18, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, paddingHorizontal: 15, marginBottom: 10, flexDirection: "row", gap: 12 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  code: { flex: 1, fontFamily: fontMono, fontSize: 12.5, fontWeight: "500", color: colors.inkPrimary },
  sev: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  message: { fontSize: 13.5, color: "rgba(60,60,67,0.75)", marginTop: 7, lineHeight: 19 },
});
