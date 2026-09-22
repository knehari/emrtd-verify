import { describe, it, expect } from "vitest";
import { DeviceAttestationService } from "../../src/modules/verification/device-attestation.service";

describe("DeviceAttestationService.verify", () => {
  it("rejette un jeton d'attestation vide sans tenter de le traiter", async () => {
    const service = new DeviceAttestationService();
    const result = await service.verify({ platform: "ios", attestationToken: "", expectedNonce: "n" });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("attestation_token_missing");
  });

  it("ne prétend JAMAIS avoir vérifié la chaîne cryptographique (verified toujours false), même avec un jeton non vide", async () => {
    const service = new DeviceAttestationService();
    const result = await service.verify({ platform: "ios", attestationToken: "opaque-token-data", expectedNonce: "n" });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("cryptographic_chain_verification_not_implemented");
  });

  it("se comporte de la même façon sur Android (même honnêteté, pas de traitement spécifique différencié à tort)", async () => {
    const service = new DeviceAttestationService();
    const result = await service.verify({ platform: "android", attestationToken: "opaque-jws-token", expectedNonce: "n" });
    expect(result.platform).toBe("android");
    expect(result.verified).toBe(false);
  });
});
