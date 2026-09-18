import { describe, it, expect, vi } from "vitest";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { KycApiKeyGuard } from "../../src/modules/kyc/kyc-api-key.guard";
import type { KycClientService } from "../../src/modules/kyc/kyc-client.service";

function buildContext(headers: Record<string, string>, request: Record<string, unknown> = {}) {
  const req = { headers, ...request };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe("KycApiKeyGuard", () => {
  it("refuse une requête sans en-tête Authorization", async () => {
    const kycClientService = { authenticate: vi.fn() } as unknown as KycClientService;
    const guard = new KycApiKeyGuard(kycClientService);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(kycClientService.authenticate).not.toHaveBeenCalled();
  });

  it("refuse un en-tête Authorization qui n'est pas de la forme Bearer", async () => {
    const kycClientService = { authenticate: vi.fn() } as unknown as KycClientService;
    const guard = new KycApiKeyGuard(kycClientService);
    const { context } = buildContext({ authorization: "Basic dXNlcjpwYXNz" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuse une clé API invalide", async () => {
    const kycClientService = { authenticate: vi.fn().mockResolvedValue(null) } as unknown as KycClientService;
    const guard = new KycApiKeyGuard(kycClientService);
    const { context } = buildContext({ authorization: "Bearer emrtd_invalid" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("autorise une clé API valide et attache le client résolu à la requête", async () => {
    const resolvedClient = { clientId: "acme", acceptedTrustLevels: ["high"], allowedFields: [] };
    const kycClientService = { authenticate: vi.fn().mockResolvedValue(resolvedClient) } as unknown as KycClientService;
    const guard = new KycApiKeyGuard(kycClientService);
    const { context, req } = buildContext({ authorization: "Bearer emrtd_valid" });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(req.kycClient).toBe(resolvedClient);
    expect(kycClientService.authenticate).toHaveBeenCalledWith("emrtd_valid");
  });
});
