/**
 * Transitions d'entrée d'écran — transcrites depuis le design v2 (`Authentik Mobile v2 Dark.dc.html`,
 * table `ANIM` et keyframes `scrPush`/`scrBack`/`scrModal`/`scrFade`/`scrVerdict`) :
 * - push : l'écran entre par la droite (0,44 s, courbe iOS cubic-bezier(.32,.72,0,1)) ;
 * - back : retour, l'écran glisse depuis -30 % en réapparaissant (0,4 s) ;
 * - modal : l'écran monte depuis le bas (0,5 s) — lancement du parcours ;
 * - fade / tab : fondu (0,3 s / 0,18 s entre onglets) ;
 * - verdict : fondu + léger zoom depuis 0,96 (0,6 s, cubic-bezier(.2,.8,.2,1)).
 * Comme dans le prototype, seul l'écran entrant est animé : il est monté à neuf à chaque changement
 * d'étape (`key` posé par l'appelant) et recouvre l'écran précédent.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions } from "react-native";
import type { ScreenAnim } from "../state";

const IOS = Easing.bezier(0.32, 0.72, 0, 1);
const SETTLE = Easing.bezier(0.2, 0.8, 0.2, 1);

export function ScreenTransition({ anim, children }: { anim: ScreenAnim; children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(anim === "none" ? 1 : 0)).current;

  useEffect(() => {
    if (anim === "none") return;
    const duration = { push: 440, back: 400, modal: 500, fade: 300, tab: 180, verdict: 600 }[anim];
    const easing = anim === "verdict" ? SETTLE : anim === "fade" || anim === "tab" ? Easing.out(Easing.ease) : IOS;
    Animated.timing(progress, { toValue: 1, duration, easing, useNativeDriver: true }).start();
  }, [anim, progress]);

  let style: object;
  switch (anim) {
    case "push":
      style = { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] };
      break;
    case "back":
      style = {
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-0.3 * width, 0] }) }],
      };
      break;
    case "modal":
      style = { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] };
      break;
    case "verdict":
      style = { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] };
      break;
    case "fade":
    case "tab":
      style = { opacity: progress };
      break;
    default:
      style = {};
  }

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
