import React, { useCallback, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import type { LightSignalSample, LivenessActionType, LivenessChallenge, LivenessSignalFrame } from "@emrtd-verify/emrtd-core";
import { FaceLivenessSessionUnavailableError, createFaceLivenessSession, type FaceLivenessSession } from "../liveness/faceLivenessSession";

/** Exactement la forme attendue par `ActiveLivenessResponseDto` côté apps/api (voir SubmitVerificationDto.activeLiveness). */
export interface ActiveLivenessSubmission {
  challenge: LivenessChallenge;
  signature: string;
  samples: LivenessSignalFrame[];
  /** Présent uniquement si `challenge.lightSequence` a été émis — voir verifyLightChallenge (packages/emrtd-core). */
  lightSamples?: LightSignalSample[];
}

interface SignedChallengeResponse {
  challenge: LivenessChallenge;
  signature: string;
}

interface LivenessChallengeScreenProps {
  apiBaseUrl: string;
  apiKey: string;
  onComplete: (submission: ActiveLivenessSubmission) => void;
  /** Permet de continuer le parcours sans liveness active (dégrade vers la liveness passive uniquement, voir VerificationProcessor) — utile tant que la capture native n'est pas disponible (voir faceLivenessSession.ts). */
  onSkip?: () => void;
  /** Injectable pour le développement/les tests sans matériel réel (passer createMockFaceLivenessSession de @emrtd-verify/emrtd-core) — par défaut la session réelle, actuellement indisponible (voir faceLivenessSession.ts pour l'état exact). */
  createSession?: () => FaceLivenessSession;
}

const ACTION_LABELS: Record<LivenessActionType, string> = {
  blink: "Clignez des yeux",
  turn_head_left: "Tournez la tête à gauche",
  turn_head_right: "Tournez la tête à droite",
  open_mouth: "Ouvrez la bouche",
  smile: "Souriez",
};

type Status = "idle" | "fetching-challenge" | "capturing" | "submitting" | "unavailable" | "error";

/**
 * Orchestration du parcours de liveness active côté mobile : émission du challenge (API), capture
 * (voir `createSession`), soumission des échantillons. L'affichage simultané de toutes les actions
 * (plutôt qu'une invite synchronisée sur chaque fenêtre temporelle) est un choix d'UI provisoire —
 * la vérification elle-même (packages/emrtd-core/src/liveness/verify.ts) exige déjà que chaque
 * action survienne dans SA fenêtre assignée, indépendamment de ce que l'UI affiche.
 */
export function LivenessChallengeScreen({ apiBaseUrl, apiKey, onComplete, onSkip, createSession = createFaceLivenessSession }: LivenessChallengeScreenProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);

  const start = useCallback(async () => {
    setStatus("fetching-challenge");
    setErrorMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/verifications/liveness-challenge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`Émission du challenge de liveness active échouée (HTTP ${response.status})`);
      }
      const signed = (await response.json()) as SignedChallengeResponse;
      setChallenge(signed.challenge);

      let session: FaceLivenessSession;
      try {
        session = createSession();
      } catch (error) {
        if (error instanceof FaceLivenessSessionUnavailableError) {
          setStatus("unavailable");
          setErrorMessage(error.message);
          return;
        }
        throw error;
      }

      setStatus("capturing");
      await session.start(signed.challenge);
      const totalDurationMs = signed.challenge.steps.length > 0 ? signed.challenge.steps[signed.challenge.steps.length - 1].windowEndMs : 0;
      await new Promise((resolve) => setTimeout(resolve, totalDurationMs));
      const { samples, lightSamples } = await session.stop();

      setStatus("submitting");
      onComplete({ challenge: signed.challenge, signature: signed.signature, samples, lightSamples });
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Erreur de capture de liveness active inconnue");
    }
  }, [apiBaseUrl, apiKey, createSession, onComplete]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vérification de vivacité</Text>
      {status === "capturing" && challenge && (
        <View style={styles.actions}>
          {challenge.steps.map((step, index) => (
            <Text key={index} style={styles.actionText}>
              {index + 1}. {ACTION_LABELS[step.action]}
            </Text>
          ))}
        </View>
      )}
      {status === "unavailable" && (
        <>
          <Text style={styles.error}>{errorMessage}</Text>
          {onSkip && <Button title="Continuer sans liveness active" onPress={onSkip} />}
        </>
      )}
      {status === "error" && errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      {(status === "idle" || status === "error") && <Button title="Démarrer la vérification" onPress={start} />}
      {(status === "fetching-challenge" || status === "capturing" || status === "submitting") && <Text>En cours…</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 18, textAlign: "center" },
  actions: { gap: 8 },
  actionText: { fontSize: 16 },
  error: { color: "#b00020", textAlign: "center" },
});
