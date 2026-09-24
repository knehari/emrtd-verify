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

const { checkConnection, submitAndAwaitResult, verifyResultSignature } = await import("../../src/backend/backendClient");

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
});
