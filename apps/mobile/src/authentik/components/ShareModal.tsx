/**
 * Modale de partage — transcrite depuis le handoff §6.13
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 633-648).
 * Les deux boutons ferment la modale (Annuler ET Exporter appellent `closeShare` dans le
 * prototype lui-même — aucun export réel n'est câblé, voir README §12 "simule").
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, Modal } from "react-native";
import { PressableFX as Pressable } from "./PressableFX";
import { fontMono, type PaletteColors } from "../theme";
import type { AuthentikDemo } from "../state";

export function ShareModal({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  return (
    <Modal visible={demo.showShare} transparent animationType="fade" onRequestClose={demo.closeShare}>
      <Pressable style={styles.overlay} onPress={demo.closeShare}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.card}>
            <Text style={styles.title}>{demo.t.shareTitle}</Text>
            <Text style={styles.sub}>{demo.t.shareSub}</Text>
            <Text style={styles.sig}>sig: 3045…c4f1 · ECDSA P-256</Text>
          </View>
          <View style={styles.buttonRow}>
            <Pressable onPress={demo.closeShare} style={styles.cancelBtn}>
              <Text style={styles.cancelLabel}>{demo.t.cancel}</Text>
            </Pressable>
            <Pressable onPress={demo.closeShare} style={styles.exportBtn}>
              <Text style={styles.exportLabel}>{demo.t.sharePdf}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.34)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.screenLight, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 34 },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: `rgba(${colors.inkBaseRgb},0.25)`, alignSelf: "center", marginBottom: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginHorizontal: 4, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "600", color: colors.inkPrimary },
  sub: { fontSize: 13, color: colors.inkSecondary, marginTop: 5, lineHeight: 19 },
  sig: { fontFamily: fontMono, fontSize: 11, lineHeight: 17, color: `rgba(${colors.inkBaseRgb},0.55)`, marginTop: 10 },
  buttonRow: { flexDirection: "row", gap: 10, marginHorizontal: 4 },
  cancelBtn: { flex: 1, borderRadius: 13, backgroundColor: colors.surface, paddingVertical: 15, alignItems: "center" },
  cancelLabel: { color: colors.accent, fontSize: 16 },
  exportBtn: { flex: 1.4, borderRadius: 13, backgroundColor: colors.accent, paddingVertical: 15, alignItems: "center" },
  exportLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
