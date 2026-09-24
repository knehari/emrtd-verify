/**
 * Drapeau en rectangle arrondi (design : 26 × 18, rayon 3, filet intérieur 0,5 px) à partir des SVG
 * embarqués (flagSvgs.ts). Accepte un code MRZ (FRA, D, RKS…) ou alpha-2 ; sans drapeau connu
 * (Nations unies, codes ICAO sans pays), une pastille neutre avec le code.
 */
import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SvgXml } from "react-native-svg";
import { toAlpha2CountryCode } from "@emrtd-verify/emrtd-core";
import { FLAG_SVGS } from "../flagSvgs";

export const Flag = memo(function Flag({ code, width = 26, height = 18 }: { code: string; width?: number; height?: number }) {
  const alpha2 = toAlpha2CountryCode(code) ?? code.toUpperCase();
  const xml = FLAG_SVGS[alpha2];
  const radius = Math.max(3, Math.round(height / 6));
  return (
    <View style={[styles.frame, { width, height, borderRadius: radius }]}>
      {xml ? (
        <SvgXml xml={xml} width={width} height={height} />
      ) : (
        <Text style={[styles.fallback, { fontSize: height * 0.5 }]}>{alpha2.slice(0, 3)}</Text>
      )}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.hairline, { borderRadius: radius }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: "#D8DCE3", alignItems: "center", justifyContent: "center" },
  hairline: { borderWidth: 0.5, borderColor: "rgba(0,0,0,0.18)" },
  fallback: { fontWeight: "700", color: "rgba(0,0,0,0.55)" },
});
