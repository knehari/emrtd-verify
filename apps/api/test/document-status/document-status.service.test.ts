import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import { DocumentStatusService } from "../../src/modules/document-status/document-status.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe("DocumentStatusService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retourne checked:false quand aucun registre n'est configuré, sans appeler fetch", async () => {
    global.fetch = vi.fn();
    const service = new DocumentStatusService(configWith({}));

    const result = await service.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: false, reported: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("délègue au client HTTPS quand LOST_STOLEN_REGISTRY_URL_TEMPLATE est configuré", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reported: true }) });
    const service = new DocumentStatusService(
      configWith({ LOST_STOLEN_REGISTRY_URL_TEMPLATE: "https://registry.example.org/status/{issuingState}/{documentNumber}" }),
    );

    const result = await service.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: true, reported: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://registry.example.org/status/FRA/12AB34567",
      expect.anything(),
    );
  });

  it("absorbe une erreur inattendue de l'implémentation plutôt que de la propager", async () => {
    const service = new DocumentStatusService(
      configWith({ LOST_STOLEN_REGISTRY_URL_TEMPLATE: "https://registry.example.org/status/{issuingState}/{documentNumber}" }),
    );
    // @ts-expect-error accès direct pour simuler une implémentation défaillante dans ce test
    service["registry"] = {
      checkStatus: () => {
        throw new Error("boom");
      },
    };

    await expect(service.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" })).resolves.toEqual({
      checked: false,
      reported: false,
    });
  });
});
