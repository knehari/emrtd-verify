import { describe, it, expect, vi, afterEach } from "vitest";
import { webcrypto } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributeTypeAndValue,
  BasicConstraints,
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  Extension,
  IssuerAndSerialNumber,
  SignedData,
  SignerInfo,
} from "pkijs";
import { Integer, OctetString, PrintableString, Utf8String } from "asn1js";
import { ensurePkiEngine, toArrayBuffer } from "@emrtd-verify/emrtd-core";
import { encodeCscaMasterList } from "@emrtd-verify/pki-trust";
import { CscaSyncService } from "../../src/modules/pki/csca-sync.service";

const subtle = webcrypto.subtle;

// --- Fixture PKI synthétique locale (réservée à ce test, même principe que packages/pki-trust) ---

async function generateCert(options: {
  commonName: string;
  countryCode: string;
  isCa: boolean;
  issuer?: { certificate: Certificate; privateKey: CryptoKey };
}) {
  ensurePkiEngine();
  const keyPair = (await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const cert = new Certificate();
  cert.version = 2;
  cert.serialNumber = new Integer({ value: Math.floor(Math.random() * 1_000_000_000) });
  const subjectRdn = [
    new AttributeTypeAndValue({ type: "2.5.4.3", value: new Utf8String({ value: options.commonName }) }),
    new AttributeTypeAndValue({ type: "2.5.4.6", value: new PrintableString({ value: options.countryCode }) }),
  ];
  cert.subject.typesAndValues.push(...subjectRdn);
  cert.issuer.typesAndValues.push(...(options.issuer ? options.issuer.certificate.subject.typesAndValues : subjectRdn));
  cert.notBefore.value = new Date(Date.now() - 60_000);
  cert.notAfter.value = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  cert.extensions = [
    new Extension({ extnID: "2.5.29.19", critical: true, extnValue: new BasicConstraints({ cA: options.isCa }).toSchema().toBER(false) }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await cert.sign(options.issuer ? options.issuer.privateKey : keyPair.privateKey, "SHA-256");

  return { certificateDer: new Uint8Array(cert.toSchema(true).toBER(false)), certificate: cert, privateKey: keyPair.privateKey };
}

async function buildSignedMasterList(certificatesDer: Uint8Array[], signer: Awaited<ReturnType<typeof generateCert>>) {
  const cscaMasterListDer = encodeCscaMasterList({ version: 0, certificatesDer });
  const cmsSigned = new SignedData({
    version: 1,
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: "2.23.136.1.1.2",
      eContent: new OctetString({ valueHex: toArrayBuffer(cscaMasterListDer) }),
    }),
    signerInfos: [
      new SignerInfo({ version: 1, sid: new IssuerAndSerialNumber({ issuer: signer.certificate.issuer, serialNumber: signer.certificate.serialNumber }) }),
    ],
    certificates: [signer.certificate],
  });
  await cmsSigned.sign(signer.privateKey, 0, "SHA-256", toArrayBuffer(cscaMasterListDer));
  const contentInfo = new ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: cmsSigned.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

// --- Prisma factice en mémoire : couvre exactement les méthodes utilisées par CscaSyncService ---

interface FakeCertificateRecord {
  batchId: string;
  countryCode: string;
  subject: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  certificateDer: Uint8Array;
  trustState: string;
  sourceKind: string;
  validatedVia?: string | null;
}

function buildFakePrisma() {
  const state = {
    runs: new Map<string, { id: string; status: string; errorMessage?: string; certificateCount?: number }>(),
    batches: new Map<string, { id: string; createdAt: Date; source?: string; masterListSignerSubject?: string; certificateCount?: number }>(),
    certificates: [] as FakeCertificateRecord[],
    trustState: undefined as { id: number; activeBatchId: string | null } | undefined,
  };

  let nextId = 0;
  const id = () => `id-${++nextId}`;

  const prisma = {
    masterListSyncRun: {
      create: vi.fn(async ({ data }: { data: { status: string; source: string } }) => {
        const run = { id: id(), ...data };
        state.runs.set(run.id, run);
        return run;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(state.runs.get(where.id)!, data);
        return state.runs.get(where.id);
      }),
    },
    cscaSyncBatch: {
      findMany: vi.fn(async () => Array.from(state.batches.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.batches.get(where.id) ?? null),
      deleteMany: vi.fn(async ({ where }: { where: { id: { notIn: string[] } } }) => {
        for (const batchId of Array.from(state.batches.keys())) {
          if (!where.id.notIn.includes(batchId)) {
            state.batches.delete(batchId);
          }
        }
      }),
    },
    cscaCertificateRecord: {
      findMany: vi.fn(async ({ where }: { where: { batchId: string; countryCode?: string; trustState?: { in: string[] } } }) => {
        return state.certificates.filter(
          (record) =>
            record.batchId === where.batchId &&
            (!where.countryCode || record.countryCode === where.countryCode) &&
            (!where.trustState || where.trustState.in.includes(record.trustState)),
        );
      }),
    },
    cscaTrustState: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) => (where.id === 1 ? (state.trustState ?? null) : null)),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        cscaSyncBatch: {
          create: vi.fn(async ({ data }: { data: { source: string; masterListSignerSubject: string; certificateCount: number } }) => {
            const batch = { id: id(), createdAt: new Date(), ...data };
            state.batches.set(batch.id, batch);
            return batch;
          }),
        },
        cscaCertificateRecord: {
          createMany: vi.fn(async ({ data }: { data: FakeCertificateRecord[] }) => {
            state.certificates.push(...data);
          }),
        },
        cscaTrustState: {
          upsert: vi.fn(async ({ create }: { create: { id: number; activeBatchId: string } }) => {
            state.trustState = { id: create.id, activeBatchId: create.activeBatchId };
            return state.trustState;
          }),
        },
      };
      return callback(tx);
    }),
    _state: state,
  };

  return prisma;
}

function buildConfig(overrides: Record<string, string | undefined>) {
  return { get: (key: string) => overrides[key] } as never;
}

describe("CscaSyncService.sync", () => {
  const originalFetch = global.fetch;
  let tmpDir: string;

  afterEach(() => {
    global.fetch = originalFetch;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTrustAnchors(certificatesDer: Uint8Array[]): string {
    tmpDir = mkdtempSync(join(tmpdir(), "emrtd-test-"));
    const path = join(tmpDir, "anchors.json");
    writeFileSync(
      path,
      JSON.stringify(certificatesDer.map((der) => ({ certificateDer: Buffer.from(der).toString("base64") }))),
    );
    return path;
  }

  it("synchronise avec succès : persiste un lot et bascule le pointeur actif", async () => {
    const signer = await generateCert({ commonName: "ICAO Master List Signer", countryCode: "UN", isCa: true });
    const csca = await generateCert({ commonName: "CSCA France", countryCode: "FRA", isCa: true });
    const masterListDer = await buildSignedMasterList([csca.certificateDer], signer);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => masterListDer.buffer });

    const anchorsPath = writeTrustAnchors([signer.certificateDer]);
    const prisma = buildFakePrisma();
    const config = buildConfig({
      PKD_MASTER_LIST_SOURCE: "https",
      PKD_MASTER_LIST_HTTPS_URL: "https://pkd.example.org/masterlist.ml",
      MASTER_LIST_SIGNER_TRUST_ANCHORS_PATH: anchorsPath,
    });

    const service = new CscaSyncService(prisma as never, config);
    const result = await service.sync();

    expect(result.status).toBe("success");
    expect(result.certificateCount).toBe(1);
    expect(prisma._state.trustState?.activeBatchId).toBeDefined();
    expect(prisma._state.certificates).toHaveLength(1);
    expect(prisma._state.certificates[0]).toMatchObject({
      batchId: prisma._state.trustState!.activeBatchId,
      countryCode: "FRA",
    });
    expect(Buffer.from(prisma._state.certificates[0].certificateDer as Uint8Array)).toEqual(Buffer.from(csca.certificateDer));
  });

  it("échoue et laisse le pointeur actif intact quand aucune ancre de confiance n'est configurée", async () => {
    const signer = await generateCert({ commonName: "ICAO Master List Signer", countryCode: "UN", isCa: true });
    const csca = await generateCert({ commonName: "CSCA France", countryCode: "FRA", isCa: true });
    const masterListDer = await buildSignedMasterList([csca.certificateDer], signer);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => masterListDer.buffer });

    const anchorsPath = writeTrustAnchors([]); // magasin vide : jamais d'auto-bootstrap
    const prisma = buildFakePrisma();
    const config = buildConfig({
      PKD_MASTER_LIST_SOURCE: "https",
      PKD_MASTER_LIST_HTTPS_URL: "https://pkd.example.org/masterlist.ml",
      MASTER_LIST_SIGNER_TRUST_ANCHORS_PATH: anchorsPath,
    });

    const service = new CscaSyncService(prisma as never, config);
    const result = await service.sync();

    expect(result.status).toBe("failed");
    expect(prisma._state.trustState).toBeUndefined();
    expect(prisma._state.batches.size).toBe(0);
  });

  it("échoue proprement quand la source de récupération est indisponible, sans modifier l'état existant", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const anchorsPath = writeTrustAnchors([]);
    const prisma = buildFakePrisma();
    const config = buildConfig({
      PKD_MASTER_LIST_SOURCE: "https",
      PKD_MASTER_LIST_HTTPS_URL: "https://pkd.example.org/masterlist.ml",
      MASTER_LIST_SIGNER_TRUST_ANCHORS_PATH: anchorsPath,
    });

    const service = new CscaSyncService(prisma as never, config);
    const result = await service.sync();

    expect(result.status).toBe("failed");
    expect(prisma._state.trustState).toBeUndefined();
  }, 15_000);
});

describe("CscaSyncService.syncCountryMasterLists", () => {
  function seedActiveBatch(prisma: ReturnType<typeof buildFakePrisma>, records: FakeCertificateRecord[]): void {
    const batchId = "seed-batch";
    prisma._state.batches.set(batchId, { id: batchId, createdAt: new Date(), source: "https", masterListSignerSubject: "CN=Seed" });
    prisma._state.certificates.push(...records.map((r) => ({ ...r, batchId })));
    prisma._state.trustState = { id: 1, activeBatchId: batchId };
  }

  it("valide une Master List nationale dont le signataire est déjà une CSCA approuvée, et l'ajoute au lot en LINK_VALIDATED", async () => {
    const csca = await generateCert({ commonName: "CSCA Test", countryCode: "TST", isCa: true });
    const masterListDer = await buildSignedMasterList([csca.certificateDer], csca);

    const prisma = buildFakePrisma();
    seedActiveBatch(prisma, [
      {
        batchId: "",
        countryCode: "TST",
        subject: "CN=CSCA Test",
        serialNumber: "already-trusted",
        notBefore: new Date(Date.now() - 1000),
        notAfter: new Date(Date.now() + 1000),
        certificateDer: csca.certificateDer,
        trustState: "ICAO_ML_VALIDATED",
        sourceKind: "icao-global-ml",
      },
    ]);

    const service = new CscaSyncService(prisma as never, buildConfig({}));
    const result = await service.syncCountryMasterLists([{ dn: "cn=x,o=ml,c=TST", countryCode: "TST", masterListCmsDer: masterListDer }]);

    expect(result.status).toBe("success");
    expect(result.validatedCountries).toBe(1);
    expect(result.skippedCountries).toBe(0);
    const newBatchId = prisma._state.trustState!.activeBatchId!;
    const persisted = prisma._state.certificates.filter((c) => c.batchId === newBatchId);
    expect(persisted.some((c) => c.trustState === "LINK_VALIDATED" && c.countryCode === "TST")).toBe(true);
  });

  it("ignore une Master List nationale dont le pays n'a encore aucune CSCA approuvée (jamais d'auto-bootstrap)", async () => {
    const csca = await generateCert({ commonName: "CSCA Inconnu", countryCode: "XXX", isCa: true });
    const masterListDer = await buildSignedMasterList([csca.certificateDer], csca);

    const prisma = buildFakePrisma();
    // Aucun lot actif préexistant — aucune CSCA approuvée pour aucun pays.
    const service = new CscaSyncService(prisma as never, buildConfig({}));
    const result = await service.syncCountryMasterLists([{ dn: "cn=x,o=ml,c=XXX", countryCode: "XXX", masterListCmsDer: masterListDer }]);

    expect(result.status).toBe("success");
    expect(result.validatedCountries).toBe(0);
    expect(result.skippedCountries).toBe(1);
    expect(prisma._state.trustState).toBeUndefined(); // aucun lot créé, rien à fusionner
  });
});
