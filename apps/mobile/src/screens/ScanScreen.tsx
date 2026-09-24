import React, { useCallback, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { NfcError } from "react-native-nfc-manager";
import { BacAuthenticationError, ChipReaderError, NfcUnavailableError, PaceAuthenticationError, readEmrtdChip, type EmrtdReadResult, type MrzAccessKey } from "../nfc/emrtdReader";

interface ScanScreenProps {
  mrzAccessKey: MrzAccessKey;
  onScanComplete: (result: EmrtdReadResult) => void;
}

/**
 * Distinct de errorMessage seul : `action` pilote ce que l'écran propose ensuite (voir bouton
 * "Réessayer"/"Rescanner la MRZ" ci-dessous), pas seulement le texte affiché — les catégories
 * d'erreurs de emrtdReader.ts appellent des réactions différentes (voir sa documentation).
 */
type ScanErrorAction = "enable-nfc" | "rescan-mrz" | "retry-nfc";

function describeScanError(error: unknown): { message: string; action: ScanErrorAction } {
  if (error instanceof NfcUnavailableError) {
    return { message: "NFC indisponible : vérifiez qu'il est activé dans les réglages de l'appareil.", action: "enable-nfc" };
  }
  if (error instanceof BacAuthenticationError || error instanceof PaceAuthenticationError) {
    return { message: "Impossible d'établir un canal sécurisé avec le document : la MRZ scannée est peut-être incorrecte.", action: "rescan-mrz" };
  }
  if (error instanceof ChipReaderError) {
    return { message: "La lecture de la puce a échoué en cours de session (transmission interrompue).", action: "retry-nfc" };
  }
  if (error instanceof NfcError.UserCancel) {
    return { message: "Lecture annulée.", action: "retry-nfc" };
  }
  if (error instanceof NfcError.SessionInvalidated || error instanceof NfcError.TagConnectionLost || error instanceof NfcError.Timeout) {
    return { message: "Session NFC interrompue : rapprochez le document du téléphone et réessayez.", action: "retry-nfc" };
  }
  return { message: error instanceof Error ? error.message : "Erreur de lecture inconnue", action: "retry-nfc" };
}

export function ScanScreen({ mrzAccessKey, onScanComplete }: ScanScreenProps) {
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [scanError, setScanError] = useState<{ message: string; action: ScanErrorAction } | null>(null);

  const startScan = useCallback(async () => {
    setStatus("scanning");
    setScanError(null);
    try {
      const result = await readEmrtdChip(mrzAccessKey);
      onScanComplete(result);
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setScanError(describeScanError(error));
    }
  }, [mrzAccessKey, onScanComplete]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Approchez le document du téléphone</Text>
      <Button
        title={scanError?.action === "rescan-mrz" ? "Rescanner la MRZ puis réessayer" : "Démarrer la lecture NFC"}
        onPress={startScan}
        disabled={status === "scanning"}
      />
      {status === "scanning" && <Text>Lecture en cours…</Text>}
      {status === "error" && scanError && <Text style={styles.error}>{scanError.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 18, textAlign: "center" },
  error: { color: "#b00020", textAlign: "center" },
});
