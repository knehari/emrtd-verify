/**
 * Traitement en cours — transcrit depuis le handoff, bloc `isProcessing`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 436-447, README §6.6).
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { fontMono, type PaletteColors } from "../theme";
import type { AuthentikDemo } from "../state";

export function ProcessingScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{demo.t.procHead}</Text>
      {demo.procRows.map((p, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: p.dot }]} />
          <Text style={[styles.label, { color: p.tone }]}>{p.label}</Text>
        </View>
      ))}
      <Text style={styles.note}>{demo.procNote}</Text>
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", paddingHorizontal: 28, backgroundColor: colors.screenLight },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5, color: colors.inkPrimary, marginBottom: 26, lineHeight: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  dot: { width: 18, height: 18, borderRadius: 9 },
  label: { fontSize: 15 },
  note: { marginTop: 28, fontFamily: fontMono, fontSize: 12, lineHeight: 18, color: colors.inkTertiary },
});
