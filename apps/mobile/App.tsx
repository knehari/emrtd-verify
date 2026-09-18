import React from "react";
import { SafeAreaView } from "react-native";
import { ScanScreen } from "./src/screens/ScanScreen";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScanScreen
        mrzAccessKey={{ documentNumber: "", dateOfBirth: "", dateOfExpiry: "" }}
        onScanComplete={(result) => {
          // TODO(roadmap Phase 4) : transmettre `result` à apps/api via POST /v1/verifications
          console.log("Lecture eMRTD terminée", result.accessProtocolUsed);
        }}
      />
    </SafeAreaView>
  );
}
