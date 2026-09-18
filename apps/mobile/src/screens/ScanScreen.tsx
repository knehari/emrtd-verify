import React, { useCallback, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { readEmrtdChip, type EmrtdReadResult, type MrzAccessKey } from "../nfc/emrtdReader";

interface ScanScreenProps {
  mrzAccessKey: MrzAccessKey;
  onScanComplete: (result: EmrtdReadResult) => void;
}

export function ScanScreen({ mrzAccessKey, onScanComplete }: ScanScreenProps) {
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startScan = useCallback(async () => {
    setStatus("scanning");
    setErrorMessage(null);
    try {
      const result = await readEmrtdChip(mrzAccessKey);
      onScanComplete(result);
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Erreur de lecture inconnue");
    }
  }, [mrzAccessKey, onScanComplete]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Approchez le document du téléphone</Text>
      <Button title="Démarrer la lecture NFC" onPress={startScan} disabled={status === "scanning"} />
      {status === "scanning" && <Text>Lecture en cours…</Text>}
      {status === "error" && errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 18, textAlign: "center" },
  error: { color: "#b00020", textAlign: "center" },
});
