// DOIT rester le tout premier import : react-native-get-random-values installe le polyfill
// crypto.getRandomValues avant que quoi que ce soit d'autre (notamment @emrtd-verify/emrtd-core,
// dont bac.ts en a besoin pour générer RND.IFD/K.IFD) ne puisse l'utiliser — React Native/Hermes
// ne l'expose pas nativement, contrairement à Node/aux navigateurs.
import "react-native-get-random-values";
import React, { useState } from "react";
import { SafeAreaView } from "react-native";
import { ScanScreen } from "./src/screens/ScanScreen";
import { LivenessChallengeScreen } from "./src/screens/LivenessChallengeScreen";

// TODO(roadmap Phase 4) : sourcer depuis la configuration de build plutôt qu'en dur.
const API_BASE_URL = "https://api.example.invalid";
const API_KEY = "";

type Step = "scan" | "liveness";

export default function App() {
  const [step, setStep] = useState<Step>("scan");

  if (step === "liveness") {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <LivenessChallengeScreen
          apiBaseUrl={API_BASE_URL}
          apiKey={API_KEY}
          onComplete={(submission) => {
            // TODO(roadmap Phase 4) : joindre `submission` à SubmitVerificationDto.activeLiveness
            // lors de POST /v1/verifications, avec le reste du résultat de lecture eMRTD.
            console.log("Liveness active terminée", submission.samples.length, "échantillons");
          }}
          onSkip={() => {
            // Capture native indisponible (voir src/liveness/faceLivenessSession.ts) — continue
            // sans liveness active plutôt que de bloquer tout le parcours.
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScanScreen
        mrzAccessKey={{ documentNumber: "", dateOfBirth: "", dateOfExpiry: "" }}
        onScanComplete={(result) => {
          // TODO(roadmap Phase 4) : transmettre `result` à apps/api via POST /v1/verifications
          console.log("Lecture eMRTD terminée", result.accessProtocolUsed);
          setStep("liveness");
        }}
      />
    </SafeAreaView>
  );
}
