/**
 * Capture caméra + OCR de la MRZ — voir authentik/README.md §"Capture caméra MRZ". Absente du
 * handoff de design (qui simule la caméra par un aplat, voir son README §2/§3) : la lecture réelle
 * est nouvelle. Le cadre-guide affiché ici définit aussi la zone recadrée avant OCR
 * (../../mrz/scanMrz.ts) — mêmes ratios, une seule source de vérité (`GUIDE`).
 *
 * Détection automatique par sondage (pas de flux image par image) : demandé "en direct, sans
 * appuyer sur un bouton", mais un vrai suivi image par image nécessiterait de remplacer
 * `expo-camera` par `react-native-vision-camera` + un plugin d'analyse par frame (nouveaux modules
 * natifs non vérifiables dans cet environnement de développement, voir la discussion de session).
 * Choix retenu à la place : une photo est prise et analysée toutes les `POLL_INTERVAL_MS`
 * automatiquement tant que l'écran est ouvert ; dès qu'une lecture valide (chiffres de contrôle
 * corrects) est trouvée, le cadre passe au vert et l'écran avance — sans bouton à appuyer, au prix
 * d'une latence perçue d'environ `POLL_INTERVAL_MS` plutôt qu'un suivi continu à 30 im/s.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Svg, { Path } from "react-native-svg";
import { PressableFX as Pressable } from "./PressableFX";
import { colors } from "../theme";
import { scanMrzFromPhoto, type MrzScanSuccess, type MrzGuideRect } from "../../mrz/scanMrz";
import type { AuthentikDemo } from "../state";

const GUIDE: MrzGuideRect = { originXRatio: 0.06, originYRatio: 0.56, widthRatio: 0.88, heightRatio: 0.16 };
const pct = (r: number) => `${r * 100}%` as const;
const POLL_INTERVAL_MS = 700;

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
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [success, setSuccess] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);

  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attemptScan = useCallback(
    async (manual: boolean) => {
      if (!cameraRef.current || stoppedRef.current || inFlightRef.current) return;
      inFlightRef.current = true;
      setScanning(true);
      if (manual) setManualError(null);
      try {
        // `skipProcessing` accélère la capture mais, per la doc expo-camera, rend l'orientation de
        // la photo imprévisible (rotation 90°/180°/270° non corrigée selon l'appareil) — le
        // recadrage ci-dessous (scanMrzFromPhoto) suppose une photo orientée comme l'aperçu affiché
        // à l'écran, donc jamais `skipProcessing: true` ici.
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.75 });
        if (photo && !stoppedRef.current) {
          const result = await scanMrzFromPhoto(photo.uri, photo.width, photo.height, GUIDE);
          if (result.ok && !stoppedRef.current) {
            stoppedRef.current = true;
            setSuccess(true);
            setScanning(false);
            setTimeout(() => onCaptured(result), 420);
            return;
          }
          if (manual) setManualError(demo.t.mrzCameraFail);
        }
      } catch {
        if (manual) setManualError(demo.t.mrzCameraFail);
      } finally {
        inFlightRef.current = false;
        setScanning(false);
        if (!stoppedRef.current) {
          pollTimerRef.current = setTimeout(() => void attemptScan(false), POLL_INTERVAL_MS);
        }
      }
    },
    [demo.t.mrzCameraFail, onCaptured],
  );

  useEffect(() => {
    if (!permission?.granted || !cameraReady) return;
    stoppedRef.current = false;
    pollTimerRef.current = setTimeout(() => void attemptScan(false), POLL_INTERVAL_MS);
    return () => {
      stoppedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [permission?.granted, cameraReady, attemptScan]);

  const forceAttempt = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    void attemptScan(true);
  }, [attemptScan]);

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
      <CameraView
        ref={cameraRef}
        style={styles.fill}
        facing="back"
        enableTorch={torch}
        onCameraReady={() => setCameraReady(true)}
      />

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
          success && styles.guideBoxSuccess,
          { left: pct(GUIDE.originXRatio), top: pct(GUIDE.originYRatio), width: pct(GUIDE.widthRatio), height: pct(GUIDE.heightRatio) },
        ]}
      />

      <View pointerEvents="none" style={[styles.hintWrap, { top: pct(Math.max(0, GUIDE.originYRatio - 0.09)) }]}>
        <Text style={styles.hintText}>{demo.t.mrzHint}</Text>
      </View>

      <View pointerEvents="none" style={styles.statusWrap}>
        {success ? (
          <Text style={styles.statusTextSuccess}>{demo.t.mrzCameraSuccess}</Text>
        ) : (
          <>
            <ActivityIndicator size="small" color="#fff" style={{ opacity: scanning ? 1 : 0.35 }} />
            <Text style={styles.statusText}>{demo.t.mrzReading}</Text>
          </>
        )}
      </View>

      {manualError ? (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorText}>{manualError}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable onPress={onManual} style={styles.manualLinkDark}>
          <Text style={styles.manualLinkDarkText}>{demo.t.mrzCameraManual}</Text>
        </Pressable>
        <Pressable onPress={forceAttempt} disabled={success} style={[styles.shutter, success && styles.shutterSuccess]}>
          <View style={[styles.shutterInner, success && styles.shutterInnerSuccess]} />
        </Pressable>
        <View style={styles.torchWrap}>
          <Pressable onPress={() => setTorch((v) => !v)} style={[styles.torchButton, torch && styles.torchButtonActive]}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"
                fill={torch ? "#0B0B0C" : "#fff"}
                stroke={torch ? "#0B0B0C" : "#fff"}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </View>
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
  guideBoxSuccess: { borderColor: "#30D158", borderWidth: 3 },
  hintWrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  hintText: { color: "#fff", fontSize: 13.5, textAlign: "center", lineHeight: 19, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  statusWrap: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 150,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  statusText: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
  statusTextSuccess: { color: "#30D158", fontSize: 14, fontWeight: "600" },
  errorBanner: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 180,
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
  torchWrap: { width: 90, alignItems: "flex-end" },
  torchButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  torchButtonActive: { backgroundColor: "#fff" },
  shutter: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterSuccess: { borderColor: "#30D158" },
  shutterInner: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.6)" },
  shutterInnerSuccess: { backgroundColor: "#30D158" },
});
