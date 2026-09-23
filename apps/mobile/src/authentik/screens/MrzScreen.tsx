/**
 * Lecture MRZ — capture caméra + OCR par défaut (voir authentik/README.md §"Capture caméra MRZ",
 * components/MrzCameraScanner.tsx, ../../mrz/scanMrz.ts), avec repli vers la saisie manuelle
 * transcrite depuis le handoff, bloc `isMrz` (`design_handoff_authentik/eMRTD Verify Mobile.dc.html`
 * lignes 299-317, README §6.2). Le handoff simule la caméra par un aplat texturé (son README §2/§3)
 * ; ici la caméra est réelle et produit les mêmes trois champs (numéro de document, dates de
 * naissance et d'expiration) qui servent de clé d'accès NFC/BAC (`readEmrtdChip`, voir
 * `apps/mobile/src/authentik/state.ts`) — qu'ils viennent de la caméra ou de la saisie manuelle, le
 * reste du parcours ne fait aucune différence.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import { PressableFX as Pressable } from "../components/PressableFX";
import { MrzCameraScanner } from "../components/MrzCameraScanner";
import type { DocumentType } from "@emrtd-verify/shared-types";
import { colors, fontMono } from "../theme";
import type { AuthentikDemo } from "../state";
import type { MrzScanSuccess } from "../../mrz/scanMrz";

const DOCUMENT_TYPES: DocumentType[] = ["ePassport", "eID", "eResidenceCard"];

export function MrzScreen({ demo }: { demo: AuthentikDemo }) {
  const fr = demo.lang === "fr";
  const { mrzForm, updateMrzForm } = demo;
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [autoFilled, setAutoFilled] = useState(false);

  const handleCaptured = (result: MrzScanSuccess) => {
    updateMrzForm({
      documentType: result.parsed.identity.documentType,
      documentNumber: result.documentNumber,
      dateOfBirth: result.dateOfBirth,
      dateOfExpiry: result.dateOfExpiry,
    });
    setAutoFilled(true);
    setMode("manual");
  };

  if (mode === "camera") {
    return (
      <View style={styles.screen}>
        <View style={styles.nav}>
          <Pressable onPress={demo.reset}>
            <Text style={styles.navCancel}>{demo.t.cancel}</Text>
          </Pressable>
          <Text style={styles.navTitle}>{demo.t.mrzTitle}</Text>
          <View style={{ width: 52 }} />
        </View>
        <MrzCameraScanner demo={demo} onCaptured={handleCaptured} onManual={() => setMode("manual")} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={demo.reset}>
          <Text style={styles.navCancel}>{demo.t.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{demo.t.mrzTitle}</Text>
        <View style={{ width: 52 }} />
      </View>

      <Text style={styles.title}>{demo.t.mrzHead}</Text>
      <Text style={styles.hint}>{demo.t.mrzHint}</Text>

      {autoFilled ? (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{demo.t.mrzCameraSuccess}</Text>
        </View>
      ) : null}

      {demo.verificationError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{demo.verificationError.message}</Text>
        </View>
      ) : null}

      <View style={styles.typeRow}>
        {DOCUMENT_TYPES.map((docType, i) => {
          const selected = mrzForm.documentType === docType;
          return (
            <Pressable
              key={docType}
              onPress={() => updateMrzForm({ documentType: docType })}
              style={[styles.typeChip, selected && styles.typeChipSelected]}
            >
              <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>{demo.t.types3[i][0]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{fr ? "Numéro du document" : "Document number"}</Text>
        <TextInput
          style={styles.input}
          value={mrzForm.documentNumber}
          onChangeText={(v) => {
            updateMrzForm({ documentNumber: v.toUpperCase() });
            setAutoFilled(false);
          }}
          placeholder="21FR345679"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{fr ? "Date de naissance (AAMMJJ)" : "Date of birth (YYMMDD)"}</Text>
        <TextInput
          style={styles.input}
          value={mrzForm.dateOfBirth}
          onChangeText={(v) => {
            updateMrzForm({ dateOfBirth: v.replace(/\D/g, "").slice(0, 6) });
            setAutoFilled(false);
          }}
          placeholder="910412"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="number-pad"
          maxLength={6}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{fr ? "Date d'expiration (AAMMJJ)" : "Date of expiry (YYMMDD)"}</Text>
        <TextInput
          style={styles.input}
          value={mrzForm.dateOfExpiry}
          onChangeText={(v) => {
            updateMrzForm({ dateOfExpiry: v.replace(/\D/g, "").slice(0, 6) });
            setAutoFilled(false);
          }}
          placeholder="310830"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="number-pad"
          maxLength={6}
        />
      </View>

      <Pressable onPress={() => setMode("camera")} style={styles.scanLink}>
        <Text style={styles.scanLinkText}>{demo.t.mrzScanCamera}</Text>
      </Pressable>

      <Pressable
        onPress={demo.submitMrz}
        disabled={!demo.mrzFormValid}
        style={[styles.submit, !demo.mrzFormValid && styles.submitDisabled]}
      >
        <Text style={styles.submitText}>{fr ? "Continuer" : "Continue"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenDark, paddingHorizontal: 20 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, paddingBottom: 18 },
  navCancel: { color: "#fff", fontSize: 15 },
  navTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  title: { color: "#fff", fontSize: 19, fontWeight: "600", marginBottom: 6, lineHeight: 24 },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20, marginBottom: 18 },
  errorBanner: {
    backgroundColor: "rgba(255,69,58,0.14)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,69,58,0.4)",
  },
  errorText: { color: "#FF6961", fontSize: 13, lineHeight: 18 },
  successBanner: {
    backgroundColor: "rgba(48,209,88,0.14)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(48,209,88,0.4)",
  },
  successText: { color: "#30D158", fontSize: 13, lineHeight: 18 },
  scanLink: { alignItems: "center", marginBottom: 14 },
  scanLinkText: { color: colors.accent, fontSize: 14 },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  typeChipSelected: { backgroundColor: "rgba(10,132,255,0.18)", borderColor: colors.accent },
  typeChipText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  typeChipTextSelected: { color: "#fff" },
  field: { marginBottom: 14 },
  label: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6 },
  input: {
    fontFamily: fontMono,
    fontSize: 15,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  submit: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  submitDisabled: { backgroundColor: "rgba(255,255,255,0.12)" },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
