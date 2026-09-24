/**
 * Icônes — chemins SVG transcrits verbatim depuis le handoff de design
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html`, constante `ICON` et éléments `<svg>`
 * inline du parcours §1a). Rendues via `react-native-svg` (mêmes chemins, donc mêmes silhouettes
 * qu'à l'écran dans le prototype HTML) plutôt qu'approximées.
 */
import React from "react";
import { View } from "react-native";
import Svg, { Path, Circle, Rect, G } from "react-native-svg";

type IconName = "check" | "warn" | "info" | "dash" | "doc" | "shield" | "share" | "globe" | "search";

const PATHS: Record<IconName, [string, string]> = {
  check: ["M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 1 1 0-18.4", "M7.9 12.3l2.8 2.8 5.4-5.9"],
  warn: ["M10.3 4.4 2.6 17.9a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z", "M12 9.4v4.3M12 17.2h.01"],
  info: ["M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 1 1 0-18.4", "M12 11.2v5M12 7.9h.01"],
  dash: ["M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 1 1 0-18.4", "M8.4 12h7.2"],
  doc: ["M6.2 2.9h6.9l4.7 4.7v13.5H6.2Z", "M9.1 12.2h6M9.1 15.7h6M9.1 8.7h3"],
  shield: ["M12 2.7 19.8 5.5v6.2c0 4.5-3.1 7.5-7.8 9.3-4.7-1.8-7.8-4.8-7.8-9.3V5.5Z", "M9.7 12.1h4.6v3.6H9.7zM10.9 12.1v-1.3a1.1 1.1 0 0 1 2.2 0v1.3"],
  share: ["M12 3.2v11.4", "M8.2 6.8 12 3.2l3.8 3.6"],
  globe: ["", ""], // rendu spécial ci-dessous (cercle + méridiens)
  search: ["", ""], // rendu spécial ci-dessous (cercle + trait)
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Icône générique à deux chemins (cercle/forme + détail intérieur), stroke uniquement — voir PATHS. */
export function Icon({ name, size = 21, color = "#0A84FF", strokeWidth = 1.7 }: IconProps) {
  if (name === "globe") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
        <Circle cx={12} cy={12} r={9.2} />
        <Path d="M2.9 12h18.2M12 2.8c2.4 2.6 3.6 5.8 3.6 9.2s-1.2 6.6-3.6 9.2M12 2.8c-2.4 2.6-3.6 5.8-3.6 9.2s1.2 6.6 3.6 9.2" />
      </Svg>
    );
  }
  if (name === "search") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <Circle cx={11} cy={11} r={7.4} />
        <Path d="M16.4 16.4 21 21" strokeLinecap="round" />
      </Svg>
    );
  }
  const [d1, d2] = PATHS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d1} />
      {d2 ? <Path d={d2} /> : null}
    </Svg>
  );
}

/** Icône NFC (3 arcs) — propre au produit, utilisée sur le bouton d'accueil, l'écran NFC, l'écran de positionnement et la barre d'onglets. */
export function NfcIcon({ size = 26, color = "#0A84FF", strokeWidth = 1.7 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M5.5 9.2 A 4 4 0 0 1 5.5 14.8" />
      <Path d="M10 5.6 A 9 9 0 0 1 10 18.4" />
      <Path d="M14.5 2 A 14 14 0 0 1 14.5 22" />
    </Svg>
  );
}

/** Icône de partage (haut de l'écran de verdict). */
export function ShareIcon({ size = 23, color = "#0A84FF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.2v11.4" />
      <Path d="M8.2 6.8 12 3.2l3.8 3.6" />
      <Path d="M6.2 11.4H5.4A1.8 1.8 0 0 0 3.6 13.2v6.2a1.8 1.8 0 0 0 1.8 1.8h13.2a1.8 1.8 0 0 0 1.8-1.8v-6.2a1.8 1.8 0 0 0-1.8-1.8h-.8" />
    </Svg>
  );
}

/** Réglages (troisième onglet du dock, design v2) : cercle cranté + deux cercles concentriques. */
export function SettingsIcon({ size = 24, color = "#0A84FF", strokeWidth = 1.7 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={8.3} strokeWidth={2.6} strokeDasharray="3.26 3.26" strokeLinecap="butt" />
      <Circle cx={12} cy={12} r={6.1} />
      <Circle cx={12} cy={12} r={2.3} />
    </Svg>
  );
}

/** Logo "flat" de l'application (design v2, `appIcon: "flat"`) : carte d'identité + deux ondes
 * NFC, trait blanc sur carré bleu arrondi. 48 px dans l'en-tête de l'accueil, 76 px dans Réglages
 * (rayon = 25 % du côté, comme dans le prototype : 12/48 et 19/76). */
export function AppIcon({ size = 48 }: { size?: number }) {
  const glyph = Math.round(size * 0.625);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: "#0A84FF", alignItems: "center", justifyContent: "center" }}>
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={2.5} y={5.5} width={15} height={13} rx={2.4} />
        <Circle cx={7.6} cy={10.6} r={1.9} />
        <Path d="M4.9 15.6c.6-1.3 1.6-1.9 2.7-1.9s2.1.6 2.7 1.9" />
        <Path d="M12 10h3M12 13h2" />
        <Path d="M19.6 9.3a3.6 3.6 0 0 1 0 5.4" />
        <Path d="M21.4 7.4a6.3 6.3 0 0 1 0 9.2" />
      </Svg>
    </View>
  );
}

/** Grande coche de validation de vivacité (disque vert, 46×46 dans le design). */
export function BigCheckIcon({ size = 46, color = "#30D158" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4.8 12.6l4.6 4.6 9.8-10.4" />
    </Svg>
  );
}

/** Couleurs des pictogrammes de documents : fond et trait suivent le thème (v2 sombre : fond
 * #2C2C2E, trait rgba(235,235,245,.3)) ; l'accent bleu est identique dans les deux modes. */
export interface GlyphProps {
  size?: number;
  fill?: string;
  inkRgb?: string;
}

/** Pictogramme Passeport (TD3) — transcrit depuis le handoff §6.1 (40×34). */
export function PassportGlyph({ size = 40, fill = "#F7F7FA", inkRgb = "60,60,67" }: GlyphProps) {
  const h = (size * 34) / 40;
  return (
    <Svg width={size} height={h} viewBox="0 0 40 34" fill="none">
      <Rect x={9.6} y={2} width={23} height={30} rx={3} fill={fill} stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.4} />
      <Path d="M13.2 2v30" stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.4} />
      <Path d="M8 4.4v25.2" stroke={`rgba(${inkRgb},0.22)`} strokeWidth={1.4} strokeLinecap="round" />
      <Circle cx={23} cy={13.4} r={5} fill="none" stroke="rgba(10,132,255,0.6)" strokeWidth={1.4} />
      <Path d="M18 13.4h10M23 8.4c2.4 2.6 2.4 7.4 0 10M23 8.4c-2.4 2.6-2.4 7.4 0 10" stroke="rgba(10,132,255,0.6)" strokeWidth={1.1} />
      <Path d="M17.6 23.4h10.8M17.6 26.8h7.4" stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/** Pictogramme Carte d'identité (TD1) — 46×34. */
export function IdCardGlyph({ size = 46, fill = "#F7F7FA", inkRgb = "60,60,67" }: GlyphProps) {
  const h = (size * 34) / 46;
  return (
    <Svg width={size} height={h} viewBox="0 0 46 34" fill="none">
      <Rect x={2} y={5} width={42} height={24.4} rx={3.4} fill={fill} stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.4} />
      <Rect x={6.6} y={10} width={11} height={13.4} rx={1.8} fill="rgba(10,132,255,0.14)" />
      <Circle cx={12.1} cy={14.6} r={2.4} fill="rgba(10,132,255,0.5)" />
      <Path d="M8.3 22.3c.4-2.3 1.9-3.5 3.8-3.5s3.4 1.2 3.8 3.5z" fill="rgba(10,132,255,0.5)" />
      <Rect x={30.4} y={9.8} width={9.4} height={7.2} rx={1.4} fill="none" stroke="rgba(10,132,255,0.55)" strokeWidth={1.3} />
      <Path d="M33.2 9.8v7.2M30.4 13.4h9.4" stroke="rgba(10,132,255,0.55)" strokeWidth={1.1} />
      <Path d="M21.4 11.4h6.2M21.4 15h5M21.4 22.4h18.4" stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/** Pictogramme Titre de séjour (TD1/TD2) — 46×34. */
export function ResidencePermitGlyph({ size = 46, fill = "#F7F7FA", inkRgb = "60,60,67" }: GlyphProps) {
  const h = (size * 34) / 46;
  return (
    <Svg width={size} height={h} viewBox="0 0 46 34" fill="none">
      <Rect x={2} y={5} width={42} height={24.4} rx={3.4} fill={fill} stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.4} />
      <Path d="M2 8.4a3.4 3.4 0 0 1 3.4-3.4h9.8v24.4H5.4A3.4 3.4 0 0 1 2 26V8.4Z" fill="rgba(10,132,255,0.12)" />
      <G fill="rgba(10,132,255,0.7)">
        <Circle cx={8.6} cy={12.4} r={1.1} />
        <Circle cx={8.6} cy={22} r={1.1} />
        <Circle cx={12.6} cy={17.2} r={1.1} />
        <Circle cx={5} cy={17.2} r={1.1} />
      </G>
      <Path d="M20.6 11h14M20.6 15.2h10.4" stroke={`rgba(${inkRgb},0.3)`} strokeWidth={1.5} strokeLinecap="round" />
      <Rect x={20.6} y={19.6} width={19.6} height={6.4} rx={1.6} fill="none" stroke="rgba(10,132,255,0.55)" strokeWidth={1.3} />
      <Path d="M23.4 22.8h9.4" stroke="rgba(10,132,255,0.55)" strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  );
}
