/**
 * Lecture MRZ en direct — voir authentik/README.md §"Capture caméra MRZ". Le flux vidéo est analysé
 * image par image par Apple Vision dans le module natif local `modules/mrz-scanner` (aucune photo
 * n'est prise) ; chaque lot de lignes reconnues passe par src/mrz/mrzFromLines.ts (corrections guidées
 * par le format, chiffres de contrôle, vote sur plusieurs images). Les lignes de forme MRZ sont
 * surlignées en vert en direct ; dès que la même lecture valide revient deux fois, l'écran avance seul.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import Svg, { Path } from "react-native-svg";
import { PressableFX as Pressable } from "./PressableFX";
import { colors } from "../theme";
import { MrzScannerView, type DetectedTextLine, type TextDetectedEvent } from "../../../modules/mrz-scanner";
import { analyzeMrzLines, isMrzLikeText, MrzConsensus, type MrzRead } from "../../mrz/mrzFromLines";
import type { AuthentikDemo } from "../state";

const GUIDE = { x: 0.06, y: 0.56, width: 0.88, height: 0.16 };
// Zone réellement analysée : le cadre élargi, pour tolérer un document un peu décalé sans lire tout
// l'écran (plus lent, et plus de texte parasite).
const SCAN_REGION = { x: 0.02, y: GUIDE.y - 0.12, width: 0.96, height: GUIDE.height + 0.24 };
const LEGACY_NOTICE_MS = 2500;
const SUCCESS_DELAY_MS = 450;
const pct = (r: number) => `${r * 100}%` as const;

type Phase = "searching" | "locking" | "success";

export function MrzCameraScanner({
  demo,
  onCaptured,
  onManual,
}: {
  demo: AuthentikDemo;
  onCaptured: (read: MrzRead) => void;
  onManual: () => void;
}) {
  const fr = demo.lang === "fr";
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>("searching");
  const [highlights, setHighlights] = useState<DetectedTextLine[]>([]);
  const [legacy, setLegacy] = useState(false);
  const consensus = useMemo(() => new MrzConsensus(), []);
  const doneRef = useRef(false);
  const timersRef = useRef<{ legacy?: ReturnType<typeof setTimeout>; success?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearTimeout(timers.legacy);
      clearTimeout(timers.success);
    };
  }, []);

  const handleTextDetected = useCallback(
    (event: TextDetectedEvent) => {
      if (doneRef.current) return;
      const { lines } = event.nativeEvent;
      setHighlights(lines.filter((line) => isMrzLikeText(line.text)));

      const analysis = analyzeMrzLines(lines);
      if (analysis.kind === "legacy-fr-id") {
        setLegacy(true);
        clearTimeout(timersRef.current.legacy);
        timersRef.current.legacy = setTimeout(() => setLegacy(false), LEGACY_NOTICE_MS);
      }

      const read = analysis.kind === "mrz" ? analysis.read : null;
      const confirmed = consensus.push(read);
      if (confirmed) {
        doneRef.current = true;
        setPhase("success");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        timersRef.current.success = setTimeout(() => onCaptured(confirmed), SUCCESS_DELAY_MS);
        return;
      }
      setPhase(read ? "locking" : "searching");
    },
    [consensus, onCaptured],
  );

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
      <MrzScannerView
        style={StyleSheet.absoluteFill}
        active={phase !== "success"}
        torch={torch}
        regionOfInterest={SCAN_REGION}
        onTextDetected={handleTextDetected}
      />

      <View pointerEvents="none" style={[styles.maskEdge, { top: 0, left: 0, right: 0, height: pct(GUIDE.y) }]} />
      <View pointerEvents="none" style={[styles.maskEdge, { top: pct(GUIDE.y), height: pct(GUIDE.height), left: 0, width: pct(GUIDE.x) }]} />
      <View
        pointerEvents="none"
        style={[styles.maskEdge, { top: pct(GUIDE.y), height: pct(GUIDE.height), right: 0, width: pct(1 - GUIDE.x - GUIDE.width) }]}
      />
      <View pointerEvents="none" style={[styles.maskEdge, { top: pct(GUIDE.y + GUIDE.height), left: 0, right: 0, bottom: 0 }]} />
      <View
        pointerEvents="none"
        style={[
          styles.guideBox,
          phase === "locking" && styles.guideBoxLocking,
          phase === "success" && styles.guideBoxSuccess,
          { left: pct(GUIDE.x), top: pct(GUIDE.y), width: pct(GUIDE.width), height: pct(GUIDE.height) },
        ]}
      />

      {highlights.map((line, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.highlight, { left: pct(line.x), top: pct(line.y), width: pct(line.width), height: pct(line.height) }]}
        />
      ))}

      <View pointerEvents="none" style={[styles.hintWrap, { top: pct(Math.max(0, GUIDE.y - 0.09)) }]}>
        <Text style={styles.hintText}>{demo.t.mrzHint}</Text>
      </View>

      <View pointerEvents="none" style={styles.statusWrap}>
        {phase === "success" ? (
          <Text style={styles.statusTextSuccess}>{demo.t.mrzCameraSuccess}</Text>
        ) : phase === "locking" ? (
          <Text style={styles.statusTextLocking}>{demo.t.mrzCameraHold}</Text>
        ) : (
          <>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.statusText}>{demo.t.mrzReading}</Text>
          </>
        )}
      </View>

      {legacy && phase !== "success" ? (
        <View style={styles.legacyBanner} pointerEvents="none">
          <Text style={styles.legacyText}>{demo.t.mrzCameraLegacy}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable onPress={onManual} style={styles.manualLinkDark}>
          <Text style={styles.manualLinkDarkText}>{demo.t.mrzCameraManual}</Text>
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
  fill: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  permissionText: { color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  permissionButton: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 },
  permissionButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  manualLink: { marginTop: 4 },
  manualLinkText: { color: colors.accent, fontSize: 14 },
  maskEdge: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  guideBox: { position: "absolute", borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  guideBoxLocking: { borderColor: "rgba(48,209,88,0.7)" },
  guideBoxSuccess: { borderColor: "#30D158", borderWidth: 3 },
  highlight: {
    position: "absolute",
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#30D158",
    backgroundColor: "rgba(48,209,88,0.18)",
  },
  hintWrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  hintText: { color: "#fff", fontSize: 13.5, textAlign: "center", lineHeight: 19, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  statusWrap: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 130,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  statusText: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
  statusTextLocking: { color: "#7EE2A0", fontSize: 14, fontWeight: "600" },
  statusTextSuccess: { color: "#30D158", fontSize: 14, fontWeight: "600" },
  legacyBanner: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 170,
    backgroundColor: "rgba(255,159,10,0.92)",
    borderRadius: 12,
    padding: 12,
  },
  legacyText: { color: "#1C1C1E", fontSize: 13, lineHeight: 18, textAlign: "center", fontWeight: "500" },
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
  manualLinkDark: { paddingVertical: 8 },
  manualLinkDarkText: { color: "#fff", fontSize: 14, opacity: 0.9 },
  torchWrap: { alignItems: "flex-end" },
  torchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  torchButtonActive: { backgroundColor: "#fff" },
});
