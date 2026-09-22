/**
 * Pays pris en charge — transcrit depuis le handoff, bloc `isCountries`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 610-631, README §6.12).
 * Champ de recherche factice dans le prototype lui-même ("Champ de recherche factice", README
 * §3) — repris à l'identique, sans filtrage réel. Drapeaux en emoji (alternative documentée par le
 * handoff aux dégradés CSS générés, voir README §3/§11) plutôt qu'un rendu SVG des couleurs.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, fontMono, radius } from "../theme";
import { Icon } from "../icons";
import type { AuthentikDemo } from "../state";

export function CountriesScreen({ demo }: { demo: AuthentikDemo }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 110 }}>
      <Pressable onPress={demo.backFromCountries} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.trustTitle}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.countriesTitle}</Text>
      <Text style={styles.sub}>{demo.t.countriesSub}</Text>

      <View style={styles.searchBar}>
        <Icon name="search" size={16} color="rgba(60,60,67,0.5)" />
        <Text style={styles.searchPlaceholder}>{demo.t.searchPh}</Text>
      </View>

      <View style={styles.list}>
        {demo.countryRows.map((c, i) => (
          <View key={c.code} style={[styles.row, i > 0 && styles.rowBorder]}>
            <Text style={styles.flag}>{c.flag}</Text>
            <Text style={styles.code}>{c.code}</Text>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={styles.anchors}>{c.anchors}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 14, lineHeight: 19 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.searchField, borderRadius: radius.search, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 14 },
  searchPlaceholder: { fontSize: 15, color: "rgba(60,60,67,0.5)" },
  list: { backgroundColor: colors.surface, borderRadius: radius.cardLg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  flag: { fontSize: 20, width: 26, textAlign: "center" },
  code: { fontFamily: fontMono, fontSize: 12, fontWeight: "600", color: "rgba(60,60,67,0.55)", width: 20 },
  name: { flex: 1, minWidth: 0, fontSize: 16, color: colors.inkPrimary },
  anchors: { fontFamily: fontMono, fontSize: 12.5, color: colors.inkTertiary },
});
