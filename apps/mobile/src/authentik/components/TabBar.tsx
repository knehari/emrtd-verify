/**
 * Barre d'onglets flottante — transcrite depuis le handoff §6.14
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 650-675).
 * "En SwiftUI, viser l'équivalent natif (matériau translucide + pilule de sélection) plutôt qu'un
 * clone CSS" (README) — ici, l'équivalent natif React Native est `expo-blur` `BlurView`, avec le
 * matériau système `systemChromeMaterial` (celui des barres d'outils/onglets natives iOS), pas le
 * flou générique `light`/`dark` utilisé précédemment.
 *
 * Fond : vrai Liquid Glass via le module natif local `modules/glass-kit` (`UIGlassEffect`, app
 * compilée avec Xcode 26 et appareil sous iOS 26 — réfraction, reflets et adaptation au contenu
 * dessinés par le système). Avant iOS 26, ce même module rend un flou système très fin avec voile,
 * reflet haut, liseré lumineux dégradé et ombre limitée à l'extérieur du verre. Le premier rendu
 * posait le flou sur un fond opaque (le porteur d'ombre) : il ne floutait rien, d'où un dock mat.
 * Un binaire sans le module garde l'ancien rendu expo-blur. La pilule "loupe de verre" animée
 * (glissement + étirement élastique + reflet mobile) marque l'onglet actif, construite avec
 * `Animated` (ni `react-native-reanimated` ni Skia ne sont des dépendances de ce projet).
 * Design v2 (`Authentik Mobile v2 Dark.dc.html`) : barre de 64 px (rayon 32, marges 16, padding 7),
 * onglets de 50 px, troisième onglet "Réglages" actif, pilule rgba(255,255,255,.13) en sombre.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { PressableFX as Pressable } from "./PressableFX";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { type PaletteColors } from "../theme";
import { NfcIcon, Icon, SettingsIcon } from "../icons";
import { GlassEffectView, GlassTabBar } from "../../../modules/glass-kit";
import type { AuthentikDemo } from "../state";

const TAB_COUNT = 3;
// Doit correspondre à `bar.paddingHorizontal` ci-dessous — la pilule et son calcul de largeur
// doivent tenir compte de ce padding, sinon elle déborde à gauche et dépasse la largeur d'un onglet
// (bug signalé : "en mode Dark la loupe n'est pas bien alignée et dépasse un peu le dock à gauche").
const BAR_PADDING = 7;

export function TabBar({ demo, bottomInset }: { demo: AuthentikDemo; bottomInset: number }) {
  const c = demo.colors;
  const dark = demo.scheme === "dark";
  const styles = useMemo(() => makeStyles(c, dark), [c, dark]);
  const inactive = `rgba(${c.inkBaseRgb},0.5)`;
  const homeActive = demo.step === "home";
  const trustActive = demo.step === "trust" || demo.step === "countries" || demo.step === "country";
  const settingsActive = demo.step === "settings" || demo.step === "server";
  const activeIndex = homeActive ? 0 : trustActive ? 1 : settingsActive ? 2 : -1;

  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = Math.max(0, barWidth - BAR_PADDING * 2) / TAB_COUNT;
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

  // iOS 26 : dock entièrement natif (SwiftUI, Liquid Glass du système, SF Symbols, pastille de
  // sélection animée et retour haptique natifs) — voir modules/glass-kit/ios/GlassTabBar.swift.
  if (GlassTabBar) {
    const actions = [demo.reset, demo.goTrust, demo.goSettings];
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
        <GlassTabBar
          style={styles.nativeBar}
          titles={[demo.t.tabVerify, demo.t.tabTrust, demo.t.tabAbout]}
          symbols={["wave.3.right", "lock.shield", "gearshape"]}
          selectedIndex={activeIndex}
          accentColor={c.accent}
          colorScheme={dark ? "dark" : "light"}
          haptics={demo.feedbackOn}
          onSelect={(e) => actions[e.nativeEvent.index]?.()}
        />
      </View>
    );
  }

  const pill =
    activeIndex >= 0 && tabWidth > 0 ? (
      <Animated.View pointerEvents="none" style={[styles.pillSlot, { width: tabWidth, transform: [{ translateX }, { scaleX: stretch }] }]}>
        <View style={styles.pill} />
        <Animated.View style={[styles.pillSheen, { opacity: sheen }]}>
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      </Animated.View>
    ) : null;

  const tabs = (
    <>
      <Pressable onPress={demo.reset} style={styles.tab}>
        <NfcIcon size={25} color={homeActive ? c.accent : inactive} strokeWidth={1.7} />
        <Text style={[styles.tabLabel, { color: homeActive ? c.accent : inactive }]}>{demo.t.tabVerify}</Text>
      </Pressable>
      <Pressable onPress={demo.goTrust} style={styles.tab}>
        <Icon name="shield" size={25} color={trustActive ? c.accent : inactive} strokeWidth={1.7} />
        <Text style={[styles.tabLabel, { color: trustActive ? c.accent : inactive }]}>{demo.t.tabTrust}</Text>
      </Pressable>
      <Pressable onPress={demo.goSettings} style={styles.tab}>
        <SettingsIcon size={24} color={settingsActive ? c.accent : inactive} strokeWidth={1.7} />
        <Text style={[styles.tabLabel, { color: settingsActive ? c.accent : inactive }]}>{demo.t.tabAbout}</Text>
      </Pressable>
    </>
  );

  if (GlassEffectView) {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
        <View style={styles.glassBar} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
          <GlassEffectView pointerEvents="none" style={StyleSheet.absoluteFill} cornerRadius={32} colorScheme={dark ? "dark" : "light"} />
          {pill}
          {tabs}
        </View>
      </View>
    );
  }

  // Binaire sans modules/glass-kit (compilé avant son ajout) : rendu expo-blur d'origine.
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 16 + bottomInset }]}>
      <View style={styles.barShadow}>
        <BlurView
          intensity={100}
          tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
          style={styles.bar}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        >
          <View style={styles.tintWash} pointerEvents="none" />
          <LinearGradient
            pointerEvents="none"
            colors={dark ? ["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]}
            style={styles.specular}
          />
          {pill}
          {tabs}
        </BlurView>
      </View>
    </View>
  );
}

const makeStyles = (colors: PaletteColors, dark: boolean) => StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, height: 64, zIndex: 35 },
  // BlurView ne peut pas porter de backgroundColor opaque (ça annulerait le flou) : l'ombre est
  // donc portée par ce wrapper opaque, entièrement recouvert par le flou, plutôt que par la
  // BlurView elle-même — évite l'avertissement de performance "cannot calculate shadow efficiently".
  barShadow: {
    flex: 1,
    borderRadius: 32,
    backgroundColor: colors.surface,
    shadowColor: dark ? "#000" : "#0A2540",
    shadowOpacity: dark ? 0.5 : 0.18,
    shadowRadius: dark ? 40 : 34,
    shadowOffset: { width: 0, height: dark ? 18 : 14 },
  },
  nativeBar: { flex: 1 },
  // Verre natif (modules/glass-kit) : ni fond, ni rognage — le verre dessine son bord et son ombre.
  glassBar: {
    flex: 1,
    borderRadius: 32,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: BAR_PADDING,
  },
  bar: {
    flex: 1,
    borderRadius: 32,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: BAR_PADDING,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  // Léger voile pour que le flou système (faible à intensité partielle, cf. UIViewPropertyAnimator
  // dans expo-blur) reste lisible même au-dessus d'un fond quasi blanc — bug signalé : "en mode
  // clair, il n'y a pas l'effet Liquid Glass" (le flou natif seul n'était pas assez perceptible).
  tintWash: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.06)" },
  specular: { position: "absolute", left: 0, right: 0, top: 0, height: "50%" },
  // Pilule "loupe de verre" : glisse et s'étire brièvement (scaleX) vers l'onglet actif, comme un
  // blob liquide qui se reforme — approximation de la morph transition du vrai Liquid Glass.
  // `left: BAR_PADDING` (plutôt que 0) : sans ça la pilule est décalée à gauche et déborde
  // (bug signalé : "en mode Dark la loupe n'est pas bien alignée et dépasse un peu le dock à gauche").
  pillSlot: { position: "absolute", top: 7, bottom: 7, left: BAR_PADDING, alignItems: "center", justifyContent: "center" },
  pill: {
    width: "100%",
    height: "100%",
    marginHorizontal: 4,
    borderRadius: 25,
    backgroundColor: colors.tabPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  // Reflet qui traverse la pilule pendant la transition, comme la lumière qui glisse sur du verre —
  // dégradé plutôt qu'un rectangle plein (bug signalé : "le reflet du dock est mal fait").
  pillSheen: {
    position: "absolute",
    left: 4,
    right: 4,
    top: 7,
    height: "38%",
    borderRadius: 18,
    overflow: "hidden",
  },
  tab: { flex: 1, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { fontSize: 10.5, fontWeight: "500", color: `rgba(${colors.inkBaseRgb},0.5)` },
});
