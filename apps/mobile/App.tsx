// DOIT rester le tout premier import : react-native-get-random-values installe le polyfill
// crypto.getRandomValues avant que quoi que ce soit d'autre (notamment @emrtd-verify/emrtd-core,
// dont bac.ts en a besoin pour générer RND.IFD/K.IFD) ne puisse l'utiliser — React Native/Hermes
// ne l'expose pas nativement, contrairement à Node/aux navigateurs.
import "react-native-get-random-values";
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
