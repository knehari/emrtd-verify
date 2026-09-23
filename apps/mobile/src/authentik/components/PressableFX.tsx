/**
 * `Pressable` avec un effet tactile systématique (léger retrait d'échelle + baisse d'opacité au
 * contact) — le handoff de design ne spécifie aucun état "pressed" (prototype HTML statique, pas
 * d'interaction tactile réelle). Remplace `Pressable` de `react-native` partout dans `authentik/`
 * via un simple alias d'import (`import { PressableFX as Pressable } from "../components/PressableFX"`),
 * pour un retour visuel cohérent sur chaque bouton sans dupliquer la logique par écran.
 */
import React from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

export function PressableFX({ style, ...rest }: PressableProps) {
  return (
    <Pressable
      style={(state) => {
        const base = typeof style === "function" ? style(state) : style;
        return [base as StyleProp<ViewStyle>, state.pressed ? styles.pressed : null];
      }}
      {...rest}
    />
  );
}

const styles = {
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] } satisfies ViewStyle,
};
