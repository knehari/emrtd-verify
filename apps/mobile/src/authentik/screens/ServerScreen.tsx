/**
 * Réglages › Serveur KYC — hors design : branche l'app sur apps/api (mode « En ligne · KYC »).
 * L'opérateur saisit l'adresse et la clé API du client KYC, teste la connexion, compare les
 * empreintes des clés publiques du serveur à celles communiquées hors bande, puis les épingle
 * (src/backend/backendClient.ts). Tant que la clé qui signe les résultats n'est pas épinglée, rien
 * n'est envoyé. Montre aussi la file d'attente des vérifications à réconcilier.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { fontMono, radius, type PaletteColors } from "../theme";
import { checkConnection, clearBackendSettings, keyFingerprint, saveBackendSettings, type ConnectionCheck } from "../../backend/backendClient";
import { getQueuedSubmissions, runSyncCycle } from "../../sync/submissionQueue";
import { syncCscaBundle } from "../../pki/cscaBundleSync";
import type { AuthentikDemo } from "../state";

const OK = "#30D158";
const WARN = "#FF9F0A";

export function ServerScreen({ demo }: { demo: AuthentikDemo }) {
  const c = demo.colors;
  const styles = useMemo(() => makeStyles(c), [c]);
  const t = demo.t.srv;
  const saved = demo.backend;
  const [url, setUrl] = useState(saved?.apiBaseUrl ?? "");
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [busy, setBusy] = useState<"test" | "sync" | "csca" | null>(null);
  const [queue, setQueue] = useState<{ pending: number; submitted: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const muted = `rgba(${c.inkBaseRgb},0.45)`;
  const canTest = url.trim().length > 0 && apiKey.trim().length > 0 && busy === null;

  const loadQueue = useCallback(async () => {
    try {
      const items = await getQueuedSubmissions();
      setQueue({
        pending: items.filter((i) => i.status === "pending").length,
        submitted: items.filter((i) => i.status === "submitted").length,
      });
    } catch {
      setQueue({ pending: 0, submitted: 0 });
    }
  }, []);
  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const test = async () => {
    setBusy("test");
    setMessage(null);
    setCheck(await checkConnection(url, apiKey.trim()));
    setBusy(null);
  };

  const pin = async () => {
    if (!check?.resultSigningKeySpkiBase64) return;
    await saveBackendSettings({
      apiBaseUrl: url,
      apiKey: apiKey.trim(),
      resultSigningKeySpkiBase64: check.resultSigningKeySpkiBase64,
      cscaBundleSigningKeySpkiBase64: check.cscaBundleSigningKeySpkiBase64,
      pinnedAt: new Date().toISOString(),
    });
    setCheck(null);
    await demo.refreshBackend();
  };

  const forget = async () => {
    await clearBackendSettings();
    setCheck(null);
    setUrl("");
    setApiKey("");
    await demo.refreshBackend();
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const { submitted, reconciled } = await runSyncCycle();
      setMessage(demo.lang === "en" ? `${submitted} sent, ${reconciled} reconciled` : `${submitted} envoyée(s), ${reconciled} réconciliée(s)`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    await loadQueue();
    setBusy(null);
  };

  const syncCsca = async () => {
    setBusy("csca");
    try {
      const bundle = await syncCscaBundle();
      setMessage(demo.lang === "en" ? `${bundle.anchors.length} CSCAs received, signature checked` : `${bundle.anchors.length} CSCA reçus, signature vérifiée`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy(null);
  };

  const keyRow = (label: string, spki: string | undefined, pinnedSpki: string | undefined) => (
    <View style={[styles.keyRow, styles.rule]}>
      <Text style={styles.keyLabel}>{label}</Text>
      <Text style={styles.fingerprint}>{spki ? keyFingerprint(spki) : t.noBundleKey}</Text>
      {spki && pinnedSpki && spki !== pinnedSpki ? <Text style={[styles.note, { color: WARN }]}>{t.keyChanged}</Text> : null}
    </View>
  );

  const queueLine = !queue
    ? "…"
    : queue.pending + queue.submitted === 0
      ? t.queueEmpty
      : demo.lang === "en"
        ? `${queue.pending} to send · ${queue.submitted} awaiting the server`
        : `${queue.pending} à envoyer · ${queue.submitted} en attente du serveur`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={demo.backFromServer} style={styles.back}>
        <Text style={styles.backLabel}>‹ {demo.t.tabAbout}</Text>
      </Pressable>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.sub}>{t.sub}</Text>

      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t.url}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder={t.urlPh}
            placeholderTextColor={muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
          />
        </View>
        <View style={[styles.field, styles.rule]}>
          <Text style={styles.fieldLabel}>{t.key}</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={t.keyPh}
            placeholderTextColor={muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
        <Pressable onPress={test} disabled={!canTest} style={[styles.action, styles.rule]}>
          {busy === "test" ? <ActivityIndicator color={c.accent} /> : null}
          <Text style={[styles.actionLabel, !canTest && busy !== "test" && { color: muted }]}>{busy === "test" ? t.testing : t.test}</Text>
        </Pressable>
      </View>

      {check ? (
        <View style={styles.card}>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: check.apiKeyAccepted && !check.error ? OK : WARN }]} />
            <Text style={styles.statusText}>{check.error ?? t.reachable}</Text>
          </View>
          {check.apiKeyAccepted && check.resultSigningKeySpkiBase64 ? (
            <>
              {keyRow(t.resultKey, check.resultSigningKeySpkiBase64, saved?.resultSigningKeySpkiBase64)}
              {keyRow(t.bundleKey, check.cscaBundleSigningKeySpkiBase64, saved?.cscaBundleSigningKeySpkiBase64)}
              <Text style={[styles.note, styles.hint]}>{t.pinHint}</Text>
              <Pressable onPress={pin} style={[styles.action, styles.rule]}>
                <Text style={styles.actionLabel}>{t.pin}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {saved?.resultSigningKeySpkiBase64 && !check ? (
        <View style={styles.card}>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: OK }]} />
            <Text style={styles.statusText} numberOfLines={1}>
              {saved.apiBaseUrl}
            </Text>
          </View>
          {keyRow(t.resultKey, saved.resultSigningKeySpkiBase64, undefined)}
          {keyRow(t.bundleKey, saved.cscaBundleSigningKeySpkiBase64, undefined)}
          {saved.pinnedAt ? <Text style={[styles.note, styles.hint]}>{`${t.pinned} ${saved.pinnedAt.slice(0, 10)}`}</Text> : null}
          {saved.cscaBundleSigningKeySpkiBase64 ? (
            <Pressable onPress={syncCsca} disabled={busy !== null} style={[styles.action, styles.rule]}>
              {busy === "csca" ? <ActivityIndicator color={c.accent} /> : null}
              <Text style={styles.actionLabel}>{busy === "csca" ? t.cscaSyncing : t.cscaSync}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={forget} style={[styles.action, styles.rule]}>
            <Text style={[styles.actionLabel, { color: c.error }]}>{t.forget}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t.queueTitle}</Text>
      <View style={styles.card}>
        <View style={styles.status}>
          <Text style={styles.statusText}>{queueLine}</Text>
        </View>
        {demo.backendReady ? (
          <Pressable onPress={syncNow} disabled={busy !== null} style={[styles.action, styles.rule]}>
            {busy === "sync" ? <ActivityIndicator color={c.accent} /> : null}
            <Text style={styles.actionLabel}>{busy === "sync" ? t.syncing : t.syncNow}</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text style={[styles.note, { marginHorizontal: 4 }]}>{message}</Text> : null}
    </ScrollView>
  );
}

const makeStyles = (colors: PaletteColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.screenLight, paddingHorizontal: 20, paddingTop: 2 },
    back: { paddingVertical: 4, paddingBottom: 10 },
    backLabel: { color: colors.accent, fontSize: 15 },
    title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, color: colors.inkPrimary, marginBottom: 6 },
    sub: { fontSize: 13, color: colors.inkSecondary, marginBottom: 16, lineHeight: 19 },
    sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, color: colors.inkSecondary, textTransform: "uppercase", marginBottom: 7, marginLeft: 4 },
    card: { backgroundColor: colors.surface, borderRadius: radius.card, overflow: "hidden", marginBottom: 20 },
    rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    field: { paddingTop: 10, paddingHorizontal: 16 },
    fieldLabel: { fontSize: 12, color: colors.inkSecondary },
    input: { fontSize: 15, paddingVertical: 8, color: colors.inkPrimary },
    action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 16 },
    actionLabel: { fontSize: 15, fontWeight: "600", color: colors.accent },
    status: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { flex: 1, fontSize: 14, color: colors.inkPrimary },
    keyRow: { paddingVertical: 10, paddingHorizontal: 16 },
    keyLabel: { fontSize: 12, color: colors.inkSecondary, marginBottom: 3 },
    fingerprint: { fontFamily: fontMono, fontSize: 12.5, letterSpacing: 0.3, color: colors.inkPrimary },
    note: { fontSize: 12, lineHeight: 16, color: colors.inkSecondary, marginTop: 4 },
    hint: { paddingHorizontal: 16, paddingBottom: 10, marginTop: 0 },
  });
