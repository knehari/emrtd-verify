/**
 * Capture caméra + OCR de la MRZ — voir authentik/README.md §"Capture caméra MRZ". Absente du
 * handoff de design (qui simule la caméra par un aplat, voir son README §2/§3) : la lecture réelle
 * est nouvelle. Le cadre-guide affiché ici définit aussi la zone recadrée avant OCR
 * (../../mrz/scanMrz.ts) — mêmes ratios, une seule source de vérité (`GUIDE`).
 */
import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { PressableFX as Pressable } from "./PressableFX";
import { colors } from "../theme";
import { scanMrzFromPhoto, type MrzScanSuccess, type MrzGuideRect } from "../../mrz/scanMrz";
import type { AuthentikDemo } from "../state";

const GUIDE: MrzGuideRect = { originXRatio: 0.06, originYRatio: 0.56, widthRatio: 0.88, heightRatio: 0.16 };
const pct = (r: number) => `${r * 100}%` as const;

export function MrzCameraScanner({
  demo,
  onCaptured,
  onManual,
}: {
  demo: AuthentikDemo;
  onCaptured: (result: MrzScanSuccess) => void;
  onManual: () => void;
}) {
  const fr = demo.lang === "fr";
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      if (!photo) throw new Error("no-photo");
      const result = await scanMrzFromPhoto(photo.uri, photo.width, photo.height, GUIDE);
      if (result.ok) {
        onCaptured(result);
      } else {
        setError(demo.t.mrzCameraFail);
      }
    } catch {
      setError(demo.t.mrzCameraFail);
    } finally {
      setBusy(false);
    }
  }, [busy, demo.t.mrzCameraFail, onCaptured]);

  if (!permission) {
    return <View style={styles.center} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>{demo.t.mrzCameraPermission}</Text>
        <Pressable
          onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
          style={styles.permissionButton}
        >
          <Text style={styles.permissionButtonText}>
            {permission.canAskAgain ? (fr ? "Autoriser" : "Allow") : demo.t.mrzCameraOpenSettings}
          </Text>
        </Pressable>
        <Pressable onPress={onManual} style={styles.manualLink}>
          <Text style={styles.manualLinkText}>{demo.t.mrzCameraManual}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={styles.fill} facing="back" />

      <View pointerEvents="none" style={[styles.maskEdge, { top: 0, left: 0, right: 0, height: pct(GUIDE.originYRatio) }]} />
      <View
        pointerEvents="none"
        style={[styles.maskEdge, { top: pct(GUIDE.originYRatio), height: pct(GUIDE.heightRatio), left: 0, width: pct(GUIDE.originXRatio) }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.maskEdge,
          { top: pct(GUIDE.originYRatio), height: pct(GUIDE.heightRatio), right: 0, width: pct(1 - GUIDE.originXRatio - GUIDE.widthRatio) },
        ]}
      />
      <View
        pointerEvents="none"
        style={[styles.maskEdge, { top: pct(GUIDE.originYRatio + GUIDE.heightRatio), left: 0, right: 0, bottom: 0 }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.guideBox,
          { left: pct(GUIDE.originXRatio), top: pct(GUIDE.originYRatio), width: pct(GUIDE.widthRatio), height: pct(GUIDE.heightRatio) },
        ]}
      />

      <View pointerEvents="none" style={[styles.hintWrap, { top: pct(Math.max(0, GUIDE.originYRatio - 0.09)) }]}>
        <Text style={styles.hintText}>{demo.t.mrzHint}</Text>
      </View>

      {error ? (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable onPress={onManual} style={styles.manualLinkDark}>
          <Text style={styles.manualLinkDarkText}>{demo.t.mrzCameraManual}</Text>
        </Pressable>
        <Pressable onPress={capture} disabled={busy} style={[styles.shutter, busy && styles.shutterBusy]}>
          {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
        </Pressable>
        <View style={{ width: 90 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  permissionText: { color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  permissionButton: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 },
  permissionButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  manualLink: { marginTop: 4 },
  manualLinkText: { color: colors.accent, fontSize: 14 },
  maskEdge: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  guideBox: { position: "absolute", borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  hintWrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  hintText: { color: "#fff", fontSize: 13.5, textAlign: "center", lineHeight: 19, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  errorBanner: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 150,
    backgroundColor: "rgba(255,69,58,0.85)",
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: "#fff", fontSize: 13, lineHeight: 18, textAlign: "center" },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  manualLinkDark: { width: 90 },
  manualLinkDarkText: { color: "#fff", fontSize: 13, opacity: 0.85 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterBusy: { opacity: 0.7 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },
});
