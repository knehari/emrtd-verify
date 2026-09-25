import { describe, it, expect, vi } from "vitest";
import { encodeChipDataEnvelope, sha256 } from "@emrtd-verify/emrtd-core";
// Fixtures réservées aux tests (voir test/verification/localVerification.test.ts).
import { generateCscaAndDsc, buildSignedSod } from "../../../../packages/emrtd-core/test/support/pkiFixtures";
import { encodeLdsSecurityObject } from "../../../../packages/emrtd-core/src/lds/ldsSecurityObjectAsn1";

/**
 * Bout en bout contre un vrai apps/api (API + worker + Postgres + Redis) — ignoré sans
 * E2E_API_URL / E2E_API_KEY. Vérifie ce que les tests à fetch simulé ne peuvent pas prouver : le
 * format d'envoi accepté par le serveur, le traitement asynchrone, et que la signature produite par
 * le serveur (Web Crypto, Node) se vérifie avec la vérification en JavaScript pur de l'app (Hermes).
 *
 *   E2E_API_URL=http://localhost:3000 E2E_API_KEY=emrtd_… pnpm --filter mobile exec vitest run test/backend/backendE2E.test.ts
 */
const apiUrl = process.env.E2E_API_URL;
const apiKey = process.env.E2E_API_KEY;

vi.mock("expo-file-system", () => ({ documentDirectory: null }));

const { checkConnection, submitAndAwaitResult, verifyResultSignature, requestLivenessChallenge } = await import("../../src/backend/backendClient");
const { ActiveLivenessRecorder, challengeEndsAt, lightColorAt } = await import("../../src/liveness/activeLiveness");

function buildDg1(mrzText: string): Uint8Array {
  const bytes = Array.from(mrzText).map((c) => c.charCodeAt(0));
  const inner = [0x5f, 0x1f, bytes.length, ...bytes];
  return Uint8Array.from([0x61, inner.length, ...inner]);
}

describe.skipIf(!apiUrl || !apiKey)("backendClient ↔ apps/api (bout en bout)", () => {
  it("connexion, envoi de la puce, résultat signé vérifié en JavaScript pur", async () => {
    const check = await checkConnection(apiUrl!, apiKey!);
    expect(check).toMatchObject({ reachable: true, apiKeyAccepted: true });
    expect(check.resultSigningKeySpkiBase64).toBeTruthy();

    const { dsc } = await generateCscaAndDsc("UTO");
    const dg1 = buildDg1("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10");
    const sod = await buildSignedSod({
      ldsSecurityObjectDer: encodeLdsSecurityObject({ version: 0, digestAlgorithm: "SHA-256", dataGroupHashes: [{ dataGroupNumber: 1, hash: sha256(dg1) }] }),
      signer: dsc,
    });

    const settings = { apiBaseUrl: apiUrl!, apiKey: apiKey!, resultSigningKeySpkiBase64: check.resultSigningKeySpkiBase64! };
    const outcome = await submitAndAwaitResult(
      settings,
      { documentType: "ePassport", chipDataBase64: encodeChipDataEnvelope({ sod, dataGroups: { 1: dg1 } }), requestedFields: ["documentNumber", "nationality"] },
      { timeoutMs: 20000, pollMs: 500 },
    );
    expect(outcome.kind).toBe("result");
    if (outcome.kind !== "result") return;
    expect(outcome.signatureValid).toBe(true);
    // CSCA « UTO » de test inconnu du serveur : rejet attendu, mais résultat signé et complet.
    expect(outcome.result.anomalies.map((a) => a.code)).toContain("NO_TRUST_ANCHOR");
    expect(outcome.result.document.fields.documentNumber?.value).toBe("L898902C3");

    // Résultat altéré après coup : la signature ne tient plus.
    expect(await verifyResultSignature({ ...outcome.result, verdict: "authentic" }, settings.resultSigningKeySpkiBase64)).toBe(false);
  }, 40000);

  it("vivacité active : défi émis par le serveur, réponse (ARKit simulé) vérifiée par le serveur, rejeu refusé", async () => {
    const check = await checkConnection(apiUrl!, apiKey!);
    const settings = { apiBaseUrl: apiUrl!, apiKey: apiKey!, resultSigningKeySpkiBase64: check.resultSigningKeySpkiBase64! };
    const issued = await requestLivenessChallenge(settings);
    const recorder = new ActiveLivenessRecorder(issued);
    const { challenge } = issued;

    // Images ARKit (horloge du téléphone) d'une personne qui fait chaque action au milieu de sa fenêtre.
    for (let server = challenge.issuedAt; server <= challengeEndsAt(challenge); server += 33) {
      const t = server - challenge.issuedAt;
      // Peau éclairée par l'écran (défi lumineux des clients à politique stricte), 60 ms de latence d'affichage.
      const shown = lightColorAt(challenge, server - 60) ?? { r: 0, g: 0, b: 0 };
      const perceivedColor = { r: 0.62 + 0.25 * shown.r, g: 0.45 + 0.25 * shown.g, b: 0.38 + 0.25 * shown.b };
      const frame = { timestamp: server - recorder.clockOffsetMs, tracked: true, anchorId: "A", eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04, jawOpen: 0.02, mouthSmileLeft: 0.03, mouthSmileRight: 0.03, headYawDegrees: 1, perceivedColor };
      for (const step of challenge.steps) {
        const k = Math.max(0, 1 - Math.abs(t - (step.windowStartMs + step.windowEndMs) / 2) / 600);
        if (k === 0) continue;
        if (step.action === "blink") frame.eyeBlinkLeft = frame.eyeBlinkRight = 0.9 * k;
        if (step.action === "open_mouth") frame.jawOpen = 0.8 * k;
        if (step.action === "smile") frame.mouthSmileLeft = frame.mouthSmileRight = 0.85 * k;
        if (step.action === "turn_head_left") frame.headYawDegrees = -35 * k;
        if (step.action === "turn_head_right") frame.headYawDegrees = 35 * k;
      }
      recorder.push(frame);
    }
    // Soumission après la fin réelle du défi (le serveur refuse des images postérieures à sa vérification).
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, challengeEndsAt(challenge) - recorder.toServerTime(Date.now())) + 300));
    const outcome = recorder.finish(recorder.toServerTime(Date.now()));
    expect(outcome.check.reasons).toEqual([]);
    expect(outcome.check.passed).toBe(true);

    const { dsc } = await generateCscaAndDsc("UTO");
    const dg1 = buildDg1("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10");
    const sod = await buildSignedSod({
      ldsSecurityObjectDer: encodeLdsSecurityObject({ version: 0, digestAlgorithm: "SHA-256", dataGroupHashes: [{ dataGroupNumber: 1, hash: sha256(dg1) }] }),
      signer: dsc,
    });
    const submission = {
      documentType: "ePassport" as const,
      chipDataBase64: encodeChipDataEnvelope({ sod, dataGroups: { 1: dg1 } }),
      activeLiveness: outcome.submission,
    };
    const first = await submitAndAwaitResult(settings, submission, { timeoutMs: 20000, pollMs: 500 });
    expect(first.kind).toBe("result");
    if (first.kind !== "result") return;
    expect(first.signatureValid).toBe(true);
    expect(first.result.activeLiveness).toMatchObject({ performed: true, passed: true });
    const codes = first.result.anomalies.map((a) => a.code);
    expect(codes).not.toContain("ACTIVE_LIVENESS_FAILED");
    expect(codes).not.toContain("ACTIVE_LIVENESS_CHALLENGE_INVALID");

    // Même réponse renvoyée : nonce déjà consommé.
    const replay = await submitAndAwaitResult(settings, submission, { timeoutMs: 20000, pollMs: 500 });
    expect(replay.kind).toBe("result");
    if (replay.kind !== "result") return;
    expect(replay.result.activeLiveness?.passed).toBe(false);
    expect(replay.result.anomalies.map((a) => a.code)).toContain("ACTIVE_LIVENESS_REPLAYED");
  }, 60000);
});
