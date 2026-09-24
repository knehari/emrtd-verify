/**
 * Fiche pays : tous les CSCA embarqués pour ce pays (trustStoreSummary.embeddedCountryCscas),
 * décodés à l'ouverture — nom, organisation, validité, clé, signature, numéro de série, source et
 * empreinte SHA-256. Un certificat de lien (émis par l'ancien CSCA pour la nouvelle clé) est signalé
 * comme tel ; toucher une carte déplie les DN complets.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { Flag } from "../components/Flag";
import { fontMono, radius, type PaletteColors } from "../theme";
import { countryName, embeddedCountryCscas, type CscaDetail } from "../trustStoreSummary";
import type { AuthentikDemo } from "../state";

const STATUS_COLOR: Record<CscaDetail["status"], string> = { valid: "#30D158", future: "#0A84FF", expired: "#8E8E93" };

function displayDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function CountryScreen({ demo }: { demo: AuthentikDemo }) {
  const styles = useMemo(() => makeStyles(demo.colors), [demo.colors]);
  const code = demo.selectedCountry ?? "";
  const cscas = useMemo(() => embeddedCountryCscas(code), [code]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const t = demo.t;
  const validCount = cscas.filter((c) => c.status === "valid").length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 110 }}>
      <Pressable onPress={demo.backFromCountry} style={styles.back}>
        <Text style={styles.backLabel}>‹ {t.countriesTitle}</Text>
      </Pressable>

      <View style={styles.header}>
        <Flag code={code} width={52} height={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{countryName(code, demo.lang)}</Text>
          <Text style={styles.sub}>
            {code} · {cscas.length} CSCA · {validCount} {t.cscaValidCount}
          </Text>
        </View>
      </View>

      {cscas.map((c) => {
        const open = expanded === c.key;
        return (
          <Pressable key={c.key} onPress={() => setExpanded(open ? null : c.key)} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cn} numberOfLines={open ? undefined : 1}>
                  {c.commonName}
                </Text>
                {c.organisation ? (
                  <Text style={styles.org} numberOfLines={open ? undefined : 1}>
                    {c.organisation}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.pill, { backgroundColor: `${STATUS_COLOR[c.status]}22` }]}>
                <Text style={[styles.pillText, { color: STATUS_COLOR[c.status] }]}>{t.cscaStatus[c.status]}</Text>
              </View>
            </View>

            <Text style={styles.validity}>
              {displayDate(c.notBefore)} → {displayDate(c.notAfter)}
              {c.isLink ? ` · ${t.cscaLink}` : ""}
            </Text>

            <Detail styles={styles} label={t.cscaKey} value={c.keyAlgorithm} />
            <Detail styles={styles} label={t.cscaSignature} value={c.signatureAlgorithm} />
            <Detail styles={styles} label={t.cscaSource} value={t.cscaSources[c.source] ?? c.source} />
            <Detail styles={styles} label={t.cscaSerial} value={c.serialNumber} mono />
            {open ? (
              <>
                <Detail styles={styles} label={t.cscaSubject} value={c.subject} mono />
                <Detail styles={styles} label={t.cscaIssuer} value={c.issuer} mono />
                <Detail styles={styles} label="SHA-256" value={c.fingerprint} mono />
              </>
            ) : (
              <Text style={styles.more}>{t.cscaMore}</Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Detail({ styles, label, value, mono }: { styles: ReturnType<typeof makeStyles>; label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailMono]} selectable>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: PaletteColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
  back: { paddingVertical: 4, paddingBottom: 10 },
  backLabel: { color: colors.accent, fontSize: 15 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5, color: colors.inkPrimary },
  sub: { fontSize: 13, color: colors.inkSecondary, marginTop: 2, fontFamily: fontMono },
  card: { backgroundColor: colors.surface, borderRadius: radius.cardLg, padding: 14, paddingHorizontal: 16, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cn: { fontSize: 16, fontWeight: "600", color: colors.inkPrimary },
  org: { fontSize: 13, color: colors.inkSecondary, marginTop: 1 },
  pill: { borderRadius: 7, paddingVertical: 3, paddingHorizontal: 8 },
  pillText: { fontSize: 12, fontWeight: "600" },
  validity: { fontFamily: fontMono, fontSize: 12.5, color: `rgba(${colors.inkBaseRgb},0.65)`, marginTop: 8, marginBottom: 6 },
  detail: { flexDirection: "row", gap: 10, paddingVertical: 4 },
  detailLabel: { width: 92, fontSize: 12.5, color: colors.inkTertiary },
  detailValue: { flex: 1, fontSize: 12.5, color: colors.inkPrimary },
  detailMono: { fontFamily: fontMono, fontSize: 11.5 },
  more: { fontSize: 12, color: colors.accent, marginTop: 4 },
});
