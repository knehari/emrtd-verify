/**
 * Commutateurs de DÉMONSTRATION (langue / réinitialisation — le commutateur de scénario a été retiré
 * depuis que la lecture NFC et la vérification réelles fonctionnent) — transcrits depuis le
 * handoff §1a (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 167-171), où ils sont
 * dessinés au-dessus du mockup de téléphone. Le README du handoff est explicite (§8) : "n'ont pas
 * d'équivalent en production" (le scénario viendrait du moteur de vérification, la langue de la
 * locale système). Conservés ici, superposés à l'app réelle, car ce premier PoC tourne sans
 * matériel (puce eMRTD, capture vivante) — sans eux, impossible de voir les trois verdicts sur un
 * appareil réel. À retirer dès qu'un vrai moteur de vérification est branché (voir le README de ce
 * dossier `apps/mobile/src/authentik/`).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PressableFX as Pressable } from "./PressableFX";
import type { AuthentikDemo } from "../state";

export function DemoControls({ demo, topInset }: { demo: AuthentikDemo; topInset: number }) {
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: topInset + 6 }]}>
      <Pressable onPress={demo.toggleLang} style={styles.pill}>
        <Text style={styles.pillText}>{demo.langLabel}</Text>
      </Pressable>
      <Pressable onPress={demo.reset} style={styles.pill}>
        <Text style={styles.pillText}>↺</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 10, flexDirection: "row", gap: 6, zIndex: 50 },
  pill: { backgroundColor: "rgba(28,28,30,0.72)", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  pillText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});
