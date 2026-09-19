import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  createHttpsMasterListSource,
  searchSingleBinaryAttribute,
  type MinimalLdapClient,
} from "../src/pkdClient";

describe("createHttpsMasterListSource", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("récupère la Master List depuis l'URL configurée", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });

    const source = createHttpsMasterListSource({ masterListUrl: "https://pkd.example.org/masterlist.ml" });
    const result = await source.fetchMasterList();

    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://pkd.example.org/masterlist.ml",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("lève une erreur explicite sur une réponse HTTP en échec", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });

    const source = createHttpsMasterListSource({ masterListUrl: "https://pkd.example.org/masterlist.ml" });

    await expect(source.fetchMasterList()).rejects.toThrow(/404/);
  });

  it("interpole le code pays dans le gabarit d'URL de CRL", async () => {
    const bytes = new Uint8Array([9, 9]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });

    const source = createHttpsMasterListSource({
      masterListUrl: "https://pkd.example.org/masterlist.ml",
      crlUrlTemplate: "https://pkd.example.org/crl/{countryCode}.crl",
    });
    await source.fetchRevocationList("FRA");

    expect(global.fetch).toHaveBeenCalledWith("https://pkd.example.org/crl/FRA.crl", expect.anything());
  });

  it("retourne undefined (pas une erreur) quand aucun gabarit de CRL n'est configuré", async () => {
    const source = createHttpsMasterListSource({ masterListUrl: "https://pkd.example.org/masterlist.ml" });
    await expect(source.fetchRevocationList("FRA")).resolves.toBeUndefined();
  });

  it("retourne undefined quand la CRL n'est pas publiée pour ce pays plutôt que de faire échouer toute la synchronisation", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });

    const source = createHttpsMasterListSource({
      masterListUrl: "https://pkd.example.org/masterlist.ml",
      crlUrlTemplate: "https://pkd.example.org/crl/{countryCode}.crl",
    });

    await expect(source.fetchRevocationList("ZZZ")).resolves.toBeUndefined();
  });
});

describe("searchSingleBinaryAttribute", () => {
  function buildFakeClient(behavior: (emitter: EventEmitter) => void): MinimalLdapClient {
    return {
      search: (_base, _options, callback) => {
        const emitter = new EventEmitter() as unknown as Parameters<typeof callback>[1];
        callback(null, emitter);
        behavior(emitter as unknown as EventEmitter);
      },
    };
  }

  it("retourne la première valeur binaire trouvée pour l'attribut demandé", async () => {
    const client = buildFakeClient((emitter) => {
      emitter.emit("searchEntry", { attributes: [{ type: "CscaMasterListData", buffers: [Buffer.from([1, 2, 3])] }] });
      emitter.emit("end");
    });

    const result = await searchSingleBinaryAttribute(client, {
      baseDn: "dc=pkd,dc=icao,dc=int",
      filter: "(cn=MasterList)",
      attribute: "CscaMasterListData",
    });

    expect(result && Array.from(result)).toEqual([1, 2, 3]);
  });

  it("retourne undefined quand aucune entrée n'est trouvée", async () => {
    const client = buildFakeClient((emitter) => {
      emitter.emit("end");
    });

    const result = await searchSingleBinaryAttribute(client, {
      baseDn: "dc=pkd,dc=icao,dc=int",
      filter: "(cn=MasterList)",
      attribute: "CscaMasterListData",
    });

    expect(result).toBeUndefined();
  });

  it("rejette la promesse en cas d'erreur de recherche", async () => {
    const client = buildFakeClient((emitter) => {
      emitter.emit("error", new Error("connexion perdue"));
    });

    await expect(
      searchSingleBinaryAttribute(client, {
        baseDn: "dc=pkd,dc=icao,dc=int",
        filter: "(cn=MasterList)",
        attribute: "CscaMasterListData",
      }),
    ).rejects.toThrow("connexion perdue");
  });

  it("rejette immédiatement si client.search échoue au démarrage", async () => {
    const client: MinimalLdapClient = {
      search: (_base, _options, callback) => callback(new Error("bind requis"), undefined as never),
    };

    await expect(
      searchSingleBinaryAttribute(client, { baseDn: "dc=x", filter: "(cn=x)", attribute: "x" }),
    ).rejects.toThrow("bind requis");
  });
});
