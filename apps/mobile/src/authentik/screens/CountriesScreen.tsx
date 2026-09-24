/**
 * Pays pris en charge — transcrit depuis le handoff, bloc `isCountries`
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html` lignes 610-631, README §6.12), avec les
 * données réelles du magasin embarqué (trustStoreSummary.ts). Drapeaux en rectangle arrondi
 * 26 × 18 (components/Flag.tsx), recherche réelle (nom FR/EN, code alpha-2 ou alpha-3, sans
 * accents) ; un pays ouvre la liste de ses CSCA (CountryScreen).
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { Flag } from "../components/Flag";
import { fontMono, radius, type PaletteColors } from "../theme";
import { Icon } from "../icons";
import { matchesCountrySearch } from "../trustStoreSummary";
import type { AuthentikDemo } from "../state";

export function CountriesScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => demo.countryRows.filter((row) => matchesCountrySearch(row, query)), [demo.countryRows, query]);
  const muted = `rgba(${demo.colors.inkBaseRgb},0.5)`;

  return (
    <View style={styles.screen}>
      <Pressable onPress={demo.backFromCountries} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.trustTitle}</Text>
      </Pressable>
      <Text style={styles.title}>{demo.t.countriesTitle}</Text>
      <Text style={styles.sub}>{demo.t.countriesSub}</Text>

      <View style={styles.searchBar}>
        <Icon name="search" size={16} color={muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={demo.t.searchPh}
          placeholderTextColor={muted}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.code}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 110 }}
        style={styles.listWrap}
        ListEmptyComponent={<Text style={styles.empty}>{demo.t.countriesEmpty}</Text>}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => demo.openCountry(item.code)}
            style={[styles.row, index === 0 && styles.rowFirst, index === rows.length - 1 && styles.rowLast, index > 0 && styles.rowBorder]}
          >
            <Flag code={item.code} />
            <Text style={styles.code}>{item.code}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.anchors}>{item.anchors}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
  sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 14, lineHeight: 19 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.searchField, borderRadius: radius.search, paddingHorizontal: 12, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 9, color: colors.inkPrimary },
  listWrap: { flex: 1 },
  empty: { textAlign: "center", color: colors.inkTertiary, fontSize: 14, marginTop: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 15, backgroundColor: colors.surface },
  rowFirst: { borderTopLeftRadius: radius.cardLg, borderTopRightRadius: radius.cardLg },
  rowLast: { borderBottomLeftRadius: radius.cardLg, borderBottomRightRadius: radius.cardLg },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  code: { fontFamily: fontMono, fontSize: 12, fontWeight: "600", color: `rgba(${colors.inkBaseRgb},0.55)`, width: 22 },
  name: { flex: 1, minWidth: 0, fontSize: 16, color: colors.inkPrimary },
  anchors: { fontFamily: fontMono, fontSize: 12.5, color: colors.inkTertiary },
  chevron: { color: colors.chevron, fontSize: 18, marginLeft: -4 },
});
