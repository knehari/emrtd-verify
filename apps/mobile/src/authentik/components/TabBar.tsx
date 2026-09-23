/**
 * Barre d'onglets flottante — transcrite depuis le handoff §6.14
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 650-675).
 * "En SwiftUI, viser l'équivalent natif (matériau translucide + pilule de sélection) plutôt qu'un
 * clone CSS" (README) — ici, l'équivalent natif React Native est `expo-blur` `BlurView`, avec le
 * matériau système `systemChromeMaterial` (celui des barres d'outils/onglets natives iOS), pas le
 * flou générique `light`/`dark` utilisé précédemment.
 *
 * Le vrai "Liquid Glass" (iOS 26, `UIGlassEffect`/`.glassEffect()` en SwiftUI/UIKit) n'est PAS
 * accessible depuis React Native/Expo : c'est une API native ajoutée en iOS 26 sans équivalent
 * dans `expo-blur` (qui expose `UIVisualEffectView`/`UIBlurEffect`, antérieur) — l'obtenir à
 * l'identique demanderait d'écrire un module natif Expo dédié. Ce fichier approxime la sensation
 * avec ce qui EST accessible : le matériau système natif le plus proche pour le fond, et une
 * pilule "loupe de verre" animée (glissement + étirement élastique + reflet mobile) pour la
 * transition entre onglets, construite avec `Animated` (déjà utilisé partout ailleurs dans ce
 * dossier — ni `react-native-reanimated` ni Skia ne sont des dépendances de ce projet).
 * Le troisième onglet ("À propos") reste inactif, comme dans le prototype.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "./PressableFX";
import { BlurView } from "expo-blur";
import { type PaletteColors } from "../theme";
import { NfcIcon, Icon } from "../icons";
import type { AuthentikDemo } from "../state";

const TAB_COUNT = 3;

export function TabBar({ demo, bottomInset }: { demo: AuthentikDemo; bottomInset: number }) {
  const c = demo.colors;
  const dark = demo.scheme === "dark";
  const styles = useMemo(() => makeStyles(c), [c]);
  const inactive = `rgba(${c.inkBaseRgb},0.5)`;
  const homeActive = demo.step === "home";
  const trustActive = demo.step === "trust" || demo.step === "countries";
  const activeIndex = homeActive ? 0 : trustActive ? 1 : -1;

  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = barWidth / TAB_COUNT;
  const translateX = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const sheen = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (activeIndex < 0 || tabWidth === 0) return;
    translateX.stopAnimation();
    Animated.parallel([
      Animated.spring(translateX, { toValue: activeIndex * tabWidth, useNativeDriver: true, damping: 16, stiffness: 220, mass: 0.7 }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1.22, duration: 130, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.spring(stretch, { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 170 }),
      ]),
      Animated.sequence([
        Animated.timing(sheen, { toValue: 1, duration: 240, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(sheen, { toValue: 0, duration: 260, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    ]).start();
  }, [activeIndex, tabWidth]);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
      <View style={styles.barShadow}>
        <BlurView
          intensity={78}
          tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
          style={styles.bar}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        >
          <View style={styles.specular} pointerEvents="none" />

          {activeIndex >= 0 && tabWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.pillSlot, { width: tabWidth, transform: [{ translateX }, { scaleX: stretch }] }]}
            >
              <View style={styles.pill} />
              <Animated.View style={[styles.pillSheen, { opacity: sheen }]} />
            </Animated.View>
          ) : null}

          <Pressable onPress={demo.reset} style={styles.tab}>
            <NfcIcon size={25} color={homeActive ? c.accent : inactive} strokeWidth={1.7} />
            <Text style={[styles.tabLabel, { color: homeActive ? c.accent : inactive }]}>{demo.t.tabVerify}</Text>
          </Pressable>
          <Pressable onPress={demo.goTrust} style={styles.tab}>
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
  // Pilule "loupe de verre" : glisse et s'étire brièvement (scaleX) vers l'onglet actif, comme un
  // blob liquide qui se reforme — approximation de la morph transition du vrai Liquid Glass.
  pillSlot: { position: "absolute", top: 7, bottom: 7, left: 0, alignItems: "center", justifyContent: "center" },
  pill: {
    width: "100%",
    height: "100%",
    marginHorizontal: 4,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.4)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  // Reflet qui traverse la pilule pendant la transition, comme la lumière qui glisse sur du verre.
  pillSheen: {
    position: "absolute",
    left: 4,
    right: 4,
    top: 7,
    height: "38%",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  tab: { flex: 1, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { fontSize: 10.5, fontWeight: "500", color: `rgba(${colors.inkBaseRgb},0.5)` },
});
