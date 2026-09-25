/**
 * Réglages — troisième onglet du dock, design v2 (`Authentik Mobile v2 Dark.dc.html`, bloc
 * `isAbout`, renommé "Réglages" au design) : identité de l'app, version, magasin CSCA (→ magasin de
 * confiance), interrupteur des sons et retours haptiques, confidentialité, informations légales.
 * Ajout hors design : la section Apparence (bascule clair/sombre, sombre par défaut), déplacée ici
 * depuis l'en-tête de l'accueil. Les lignes légales ne mènent nulle part, comme dans le prototype.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { fontMono, radius, type PaletteColors } from "../theme";
import { AppIcon } from "../icons";
import { ModeSwitch } from "./HomeScreen";
import { embeddedStoreRows } from "../trustStoreSummary";
import { revocationCacheSummary } from "../../pki/crlCache";
import { glassStatus } from "../../../modules/glass-kit";
import type { AuthentikDemo } from "../state";

export function SettingsScreen({ demo }: { demo: AuthentikDemo }) {
  const c = demo.colors;
  const styles = useMemo(() => makeStyles(c), [c]);
  const t = demo.t;
  const [crlSummary, setCrlSummary] = useState<string>("…");
  useEffect(() => {
    revocationCacheSummary()
      .then(({ countries, lastFetchedAt }) =>
        setCrlSummary(
          countries === 0
            ? t.aboutCrlCacheNone
            : `${countries} ${demo.lang === "fr" ? "pays" : countries > 1 ? "countries" : "country"}${lastFetchedAt ? ` · ${lastFetchedAt.slice(0, 10)}` : ""}`,
        ),
      )
      .catch(() => setCrlSummary(t.aboutCrlCacheNone));
  }, [demo.lang, t.aboutCrlCacheNone]);
  const glass = glassStatus();
  const dockGlassLine =
    glass.kind === "native"
      ? t.dockGlass.native
      : glass.kind === "no-module"
        ? t.dockGlass.noModule
        : glass.kind === "old-sdk"
          ? t.dockGlass.oldSdk
          : t.dockGlass.oldIos.replace("{v}", glass.osVersion);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 110 }}>
      <View style={styles.hero}>
        <AppIcon size={76} />
        <Text style={styles.appName}>{t.appName}</Text>
        <Text style={styles.version}>{t.aboutVersion}</Text>
        <Text style={styles.tagline}>{t.aboutTagline}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutAppTitle}</Text>
      <View style={styles.card}>
        {t.aboutApp.map(([label, value], i) => (
          <View key={label} style={[styles.row, i > 0 && styles.rule]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>{t.aboutStoreTitle}</Text>
      <View style={styles.card}>
        {[...embeddedStoreRows(demo.lang), [t.aboutCrlCache, crlSummary] as [string, string]].map(([label, value], i) => (
          <View key={label} style={[styles.row, i > 0 && styles.rule]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}
        <Pressable onPress={demo.goTrustPush} style={[styles.row, styles.rule]}>
          <Text style={[styles.rowLabel, { color: c.accent }]}>{t.aboutStoreCta}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutServerTitle}</Text>
      <View style={styles.card}>
        <Pressable onPress={demo.goServer} style={styles.row}>
          <Text style={styles.rowLabel}>{t.aboutServer}</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {demo.backendReady && demo.backend ? demo.backend.apiBaseUrl.replace(/^https?:\/\//, "") : t.aboutServerNone}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutFbTitle}</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleLabel}>{t.aboutFb}</Text>
            <Text style={styles.toggleDesc}>{t.aboutFbDesc}</Text>
          </View>
          <ModeSwitch on={demo.feedbackOn} onToggle={demo.toggleFeedback} colors={c} label={t.aboutFb} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutChecksTitle}</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleLabel}>{t.aboutCrl}</Text>
            <Text style={styles.toggleDesc}>{t.aboutCrlDesc}</Text>
          </View>
          <ModeSwitch on={demo.requireRevocationCheck} onToggle={demo.toggleRevocationCheck} colors={c} label={t.aboutCrl} />
        </View>
        <View style={[styles.toggleRow, styles.rule]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleLabel}>{t.aboutLostStolen}</Text>
            <Text style={styles.toggleDesc}>{t.aboutLostStolenDesc}</Text>
          </View>
          <ModeSwitch on={demo.requireLostStolenCheck} onToggle={demo.toggleLostStolenCheck} colors={c} label={t.aboutLostStolen} />
        </View>
        {demo.faceMatchAvailable ? (
          <View style={[styles.toggleRow, styles.rule]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.toggleLabel}>{t.aboutFace}</Text>
              <Text style={styles.toggleDesc}>{t.aboutFaceDesc}</Text>
            </View>
            <ModeSwitch on={demo.faceMatchEnabled} onToggle={demo.toggleFaceMatch} colors={c} label={t.aboutFace} />
          </View>
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>{t.aboutAppearanceTitle}</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleLabel}>{t.aboutDarkMode}</Text>
            <Text style={styles.toggleDesc}>{t.aboutDarkModeDesc}</Text>
          </View>
          <ModeSwitch on={demo.scheme === "dark"} onToggle={demo.toggleScheme} colors={c} label={t.aboutDarkMode} />
        </View>
        <View style={[styles.toggleRow, styles.rule]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleLabel}>{t.aboutDock}</Text>
            <Text style={styles.toggleDesc}>{dockGlassLine}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutPrivacyTitle}</Text>
      <View style={[styles.card, styles.privacy]}>
        <Text style={styles.privacyText}>{t.aboutPrivacy}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t.aboutLegalTitle}</Text>
      <View style={[styles.card, { marginBottom: 0 }]}>
        {t.aboutLegal.map((label, i) => (
          <View key={label} style={[styles.row, i > 0 && styles.rule]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>{t.aboutFooter}</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
    hero: { alignItems: "center", paddingTop: 16, paddingBottom: 22 },
    appName: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4, color: colors.inkPrimary, marginTop: 12 },
    version: { fontFamily: fontMono, fontSize: 13, color: colors.inkSecondary, marginTop: 6 },
    tagline: { fontSize: 13.5, lineHeight: 19.5, color: colors.inkSecondary, textAlign: "center", marginTop: 10, maxWidth: 260 },
    sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, color: colors.inkSecondary, textTransform: "uppercase", marginBottom: 7, marginLeft: 4 },
    card: { backgroundColor: colors.surface, borderRadius: radius.card, overflow: "hidden", marginBottom: 20 },
    rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
    rowLabel: { flex: 1, fontSize: 15, color: colors.inkPrimary },
    rowValue: { fontFamily: fontMono, fontSize: 13, fontWeight: "500", color: colors.inkSecondary },
    chevron: { color: colors.chevron, fontSize: 20 },
    toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 16 },
    toggleLabel: { fontSize: 15, lineHeight: 19, color: colors.inkPrimary },
    toggleDesc: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary, marginTop: 2 },
    privacy: { paddingVertical: 13, paddingHorizontal: 16 },
    privacyText: { fontSize: 13.5, lineHeight: 19.5, color: `rgba(${colors.inkBaseRgb},0.75)` },
    footer: { fontSize: 11.5, lineHeight: 17, color: `rgba(${colors.inkBaseRgb},0.45)`, textAlign: "center", marginTop: 18, marginHorizontal: 4 },
  });
