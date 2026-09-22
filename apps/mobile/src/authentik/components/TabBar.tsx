/**
 * Barre d'onglets flottante — transcrite depuis le handoff §6.14
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 650-675).
 * "En SwiftUI, viser l'équivalent natif (matériau translucide + pilule de sélection) plutôt qu'un
 * clone CSS" (README) — ici, l'équivalent natif React Native est `expo-blur` `BlurView`.
 * Le troisième onglet ("À propos") reste inactif, comme dans le prototype.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { colors } from "../theme";
import { NfcIcon, Icon } from "../icons";
import type { AuthentikDemo } from "../state";

export function TabBar({ demo, bottomInset }: { demo: AuthentikDemo; bottomInset: number }) {
  const homeActive = demo.step === "home";
  const trustActive = demo.step === "trust" || demo.step === "countries";
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
      <BlurView intensity={60} tint="light" style={styles.bar}>
        <View style={styles.specular} pointerEvents="none" />
        <Pressable onPress={demo.reset} style={[styles.tab, homeActive && styles.tabActive]}>
          <NfcIcon size={25} color={homeActive ? colors.accent : "rgba(60,60,67,0.5)"} strokeWidth={1.7} />
          <Text style={[styles.tabLabel, { color: homeActive ? colors.accent : "rgba(60,60,67,0.5)" }]}>{demo.t.tabVerify}</Text>
        </Pressable>
        <Pressable onPress={demo.goTrust} style={[styles.tab, trustActive && styles.tabActive]}>
          <Icon name="shield" size={25} color={trustActive ? colors.accent : "rgba(60,60,67,0.5)"} strokeWidth={1.7} />
          <Text style={[styles.tabLabel, { color: trustActive ? colors.accent : "rgba(60,60,67,0.5)" }]}>{demo.t.tabTrust}</Text>
        </Pressable>
        <View style={styles.tab}>
          <Icon name="info" size={24} color="rgba(60,60,67,0.5)" strokeWidth={1.7} />
          <Text style={styles.tabLabel}>{demo.t.tabAbout}</Text>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 14, right: 14, height: 62, zIndex: 35 },
  bar: {
    flex: 1,
    borderRadius: 31,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    overflow: "hidden",
    shadowColor: "#0A2540",
    shadowOpacity: 0.18,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 },
  },
  specular: { position: "absolute", left: 0, right: 0, top: 0, height: "50%", backgroundColor: "rgba(255,255,255,0.25)" },
  tab: { flex: 1, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", gap: 3 },
  tabActive: { backgroundColor: "rgba(10,132,255,0.14)" },
  tabLabel: { fontSize: 10.5, fontWeight: "500", color: "rgba(60,60,67,0.5)" },
});
