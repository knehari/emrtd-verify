/**
 * Barre d'onglets flottante — transcrite depuis le handoff §6.14
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 650-675).
 * "En SwiftUI, viser l'équivalent natif (matériau translucide + pilule de sélection) plutôt qu'un
 * clone CSS" (README) — ici, l'équivalent natif React Native est `expo-blur` `BlurView`.
 * Le troisième onglet ("À propos") reste inactif, comme dans le prototype.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { PressableFX as Pressable } from "./PressableFX";
import { BlurView } from "expo-blur";
import { type PaletteColors } from "../theme";
import { NfcIcon, Icon } from "../icons";
import type { AuthentikDemo } from "../state";

export function TabBar({ demo, bottomInset }: { demo: AuthentikDemo; bottomInset: number }) {
  const c = demo.colors;
  const styles = useMemo(() => makeStyles(c), [c]);
  const inactive = `rgba(${c.inkBaseRgb},0.5)`;
  const homeActive = demo.step === "home";
  const trustActive = demo.step === "trust" || demo.step === "countries";
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
      <View style={styles.barShadow}>
        <BlurView intensity={60} tint={demo.scheme === "dark" ? "dark" : "light"} style={styles.bar}>
          <View style={styles.specular} pointerEvents="none" />
          <Pressable onPress={demo.reset} style={[styles.tab, homeActive && styles.tabActive]}>
            <NfcIcon size={25} color={homeActive ? c.accent : inactive} strokeWidth={1.7} />
            <Text style={[styles.tabLabel, { color: homeActive ? c.accent : inactive }]}>{demo.t.tabVerify}</Text>
          </Pressable>
          <Pressable onPress={demo.goTrust} style={[styles.tab, trustActive && styles.tabActive]}>
            <Icon name="shield" size={25} color={trustActive ? c.accent : inactive} strokeWidth={1.7} />
            <Text style={[styles.tabLabel, { color: trustActive ? c.accent : inactive }]}>{demo.t.tabTrust}</Text>
          </Pressable>
          <View style={styles.tab}>
            <Icon name="info" size={24} color={inactive} strokeWidth={1.7} />
            <Text style={styles.tabLabel}>{demo.t.tabAbout}</Text>
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  wrap: { position: "absolute", left: 14, right: 14, height: 62, zIndex: 35 },
  // BlurView ne peut pas porter de backgroundColor opaque (ça annulerait le flou) : l'ombre est
  // donc portée par ce wrapper opaque, entièrement recouvert par le flou, plutôt que par la
  // BlurView elle-même — évite l'avertissement de performance "cannot calculate shadow efficiently".
  barShadow: {
    flex: 1,
    borderRadius: 31,
    backgroundColor: colors.surface,
    shadowColor: "#0A2540",
    shadowOpacity: 0.18,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 },
  },
  bar: {
    flex: 1,
    borderRadius: 31,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  specular: { position: "absolute", left: 0, right: 0, top: 0, height: "50%", backgroundColor: "rgba(255,255,255,0.25)" },
  tab: { flex: 1, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", gap: 3 },
  tabActive: { backgroundColor: "rgba(10,132,255,0.14)" },
  tabLabel: { fontSize: 10.5, fontWeight: "500", color: `rgba(${colors.inkBaseRgb},0.5)` },
});
