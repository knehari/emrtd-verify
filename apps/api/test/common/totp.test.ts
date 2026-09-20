import { describe, it, expect } from "vitest";
import { buildTotpOtpauthUrl, generateTotpCode, generateTotpQrCodeDataUrl, generateTotpSecret, verifyTotpCode } from "../../src/common/security/totp";

describe("totp", () => {
  it("génère un secret Base32 utilisable pour produire et vérifier un code", async () => {
    const secret = generateTotpSecret();
    const code = await generateTotpCode(secret);

    expect(code).toMatch(/^\d{6}$/);
    await expect(verifyTotpCode(code, secret)).resolves.toBe(true);
  });

  it("rejette un code généré à partir d'un secret différent", async () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeForB = await generateTotpCode(secretB);

    await expect(verifyTotpCode(codeForB, secretA)).resolves.toBe(false);
  });

  it("rejette un code arbitraire non conforme au secret", async () => {
    const secret = generateTotpSecret();
    await expect(verifyTotpCode("000000", secret)).resolves.toBe(false);
  });

  it("construit une URI otpauth:// exploitable par une application d'authentification", () => {
    const secret = generateTotpSecret();
    const url = buildTotpOtpauthUrl("ops@example.org", secret);

    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("emrtd-verify");
    expect(decodeURIComponent(url)).toContain("ops@example.org");
  });

  it("génère un QR code en data URL PNG à partir de l'URI otpauth", async () => {
    const secret = generateTotpSecret();
    const url = buildTotpOtpauthUrl("ops@example.org", secret);
    const dataUrl = await generateTotpQrCodeDataUrl(url);

    expect(dataUrl).toContain("data:image/png;base64,");
  });
});
