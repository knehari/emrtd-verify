/**
 * Racine de l'application Authentik — assemble la machine à états (`state.ts`) et les écrans
 * transcrits du handoff de design (`design_handoff_authentik/`, voir son README pour la
 * spécification complète). Contrairement au prototype HTML (mockup de téléphone dessiné en CSS
 * dans un navigateur, barre d'état/notch/home indicator dessinés à la main — voir son README §6),
 * cette app tourne plein écran sur un vrai appareil : la barre d'état, le notch/l'île dynamique et
 * l'indicateur d'accueil sont ceux du système, via `react-native-safe-area-context` et
 * `expo-status-bar`, pas redessinés.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthentikDemo } from "./state";
import { HomeScreen } from "./screens/HomeScreen";
import { MrzScreen } from "./screens/MrzScreen";
import { PlaceScreen } from "./screens/PlaceScreen";
import { NfcScreen } from "./screens/NfcScreen";
import { SelfieScreen } from "./screens/SelfieScreen";
import { ProcessingScreen } from "./screens/ProcessingScreen";
import { VerdictScreen } from "./screens/VerdictScreen";
import { FieldsScreen } from "./screens/FieldsScreen";
import { ChainScreen } from "./screens/ChainScreen";
import { AnomaliesScreen } from "./screens/AnomaliesScreen";
import { TrustScreen } from "./screens/TrustScreen";
import { CountriesScreen } from "./screens/CountriesScreen";
import { TabBar } from "./components/TabBar";
import { ShareModal } from "./components/ShareModal";
import { DemoControls } from "./components/DemoControls";

function AuthentikRoot() {
  const demo = useAuthentikDemo();
  const insets = useSafeAreaInsets();

  let Screen: React.ReactElement;
  switch (demo.step) {
    case "home":
      Screen = <HomeScreen demo={demo} />;
      break;
    case "mrz":
      Screen = <MrzScreen demo={demo} />;
      break;
    case "place":
      Screen = <PlaceScreen demo={demo} />;
      break;
    case "nfc":
      Screen = <NfcScreen demo={demo} />;
      break;
    case "selfie":
      Screen = <SelfieScreen demo={demo} />;
      break;
    case "processing":
      Screen = <ProcessingScreen demo={demo} />;
      break;
    case "verdict":
      Screen = <VerdictScreen demo={demo} />;
      break;
    case "fields":
      Screen = <FieldsScreen demo={demo} />;
      break;
    case "chain":
      Screen = <ChainScreen demo={demo} />;
      break;
    case "anomalies":
      Screen = <AnomaliesScreen demo={demo} />;
      break;
    case "trust":
      Screen = <TrustScreen demo={demo} />;
      break;
    case "countries":
      Screen = <CountriesScreen demo={demo} />;
      break;
  }

  return (
    <View style={[styles.root, { backgroundColor: demo.screenBg }]}>
      <StatusBar style={demo.darkScreen ? "light" : "dark"} />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: demo.showTabs ? 0 : insets.bottom }]}>{Screen}</View>
      {demo.showTabs ? <TabBar demo={demo} bottomInset={insets.bottom} /> : null}
      <DemoControls demo={demo} topInset={insets.top} />
      <ShareModal demo={demo} />
    </View>
  );
}

export function AuthentikApp() {
  return (
    <SafeAreaProvider>
      <AuthentikRoot />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
