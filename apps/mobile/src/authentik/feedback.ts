/**
 * Retours haptiques et sonores — transcrits depuis le design v2 (`Authentik Mobile v2 Dark.dc.html`,
 * méthode `fb(kind)` et tables `TONES`/`VIB`) : un palier NFC ou une phase de vivacité franchis
 * donnent un "tick", l'appui sur Vérifier un "tap", la fin d'une lecture ou la vivacité validée un
 * "live", le verdict un "success"/"warning"/"error" selon son état.
 *
 * Le prototype vibrait via `navigator.vibrate` (motifs en ms) ; ici on passe par les générateurs
 * natifs iOS d'`expo-haptics` (impact léger/moyen, notification succès/avertissement/erreur) —
 * exactement les libellés qu'affichait la bulle "Haptique · …" du prototype. Les sons sont les
 * mêmes tonalités, pré-rendues en WAV par `scripts/generate-feedback-tones.js` (WebAudio n'existe
 * pas en React Native). Ils respectent le bouton silencieux de l'iPhone (mode audio par défaut
 * d'expo-av), comme les sons système.
 */
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";

export type FeedbackKind = "tick" | "tap" | "live" | "success" | "warning" | "error";

const SOUND_FILES: Record<FeedbackKind, number> = {
  tick: require("../../assets/authentik/sounds/tick.wav"),
  tap: require("../../assets/authentik/sounds/tap.wav"),
  live: require("../../assets/authentik/sounds/live.wav"),
  success: require("../../assets/authentik/sounds/success.wav"),
  warning: require("../../assets/authentik/sounds/warning.wav"),
  error: require("../../assets/authentik/sounds/error.wav"),
};

const sounds: Partial<Record<FeedbackKind, Audio.Sound>> = {};

async function playSound(kind: FeedbackKind) {
  let sound = sounds[kind];
  if (!sound) {
    sound = (await Audio.Sound.createAsync(SOUND_FILES[kind])).sound;
    sounds[kind] = sound;
  }
  await sound.replayAsync();
}

function playHaptic(kind: FeedbackKind) {
  switch (kind) {
    case "tick":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case "tap":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case "live":
    case "success":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case "warning":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case "error":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

/** Déclenche le retour `kind` ; ne fait rien si l'utilisateur a coupé les retours dans Réglages.
 * Un échec (module natif absent d'un ancien dev client, audio indisponible) est ignoré : un retour
 * manqué ne doit jamais interrompre le parcours de vérification. */
export function feedback(kind: FeedbackKind, enabled: boolean) {
  if (!enabled) return;
  playHaptic(kind)?.catch(() => {});
  playSound(kind).catch(() => {});
}
