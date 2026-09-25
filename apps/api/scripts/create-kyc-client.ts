/**
 * Provisionnement d'un client KYC — jamais via un endpoint HTTP public (voir
 * docs/kyc-integration.md "Authentification" : l'auto-inscription contredirait le principe
 * même d'une liste de clients autorisés). La clé API générée n'est affichée qu'une seule fois :
 * seul son hachage SHA-256 est stocké (voir KycClientService).
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api create-kyc-client -- \
 *     --client-id=acme-bank --trust-levels=high,medium --fields=dateOfBirth,nationality [--lost-stolen=optional]
 *
 * --lost-stolen=optional : registre des documents perdus/volés non exigé pour ce client (un
 * registre non interrogé devient une simple information) ; par défaut : exigé.
 * --active-liveness=optional : vivacité active non exigée ; par défaut : exigée.
 */
import { PrismaClient } from "@prisma/client";
import { KycClientService } from "../src/modules/kyc/kyc-client.service";

function parseArgs(argv: string[]): {
  clientId: string;
  trustLevels: string[];
  fields: string[];
  lostStolenCheckRequired: boolean;
  activeLivenessRequired: boolean;
} {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      options.set(match[1], match[2]);
    }
  }

  const clientId = options.get("client-id");
  if (!clientId) {
    throw new Error("--client-id=<identifiant> est requis");
  }

  const trustLevels = (options.get("trust-levels") ?? "high,medium").split(",").map((s) => s.trim());
  for (const level of trustLevels) {
    if (!["high", "medium", "low"].includes(level)) {
      throw new Error(`Niveau de confiance invalide : "${level}" (attendu : high, medium ou low)`);
    }
  }

  const fields = (options.get("fields") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const lostStolen = options.get("lost-stolen") ?? "required";
  if (lostStolen !== "required" && lostStolen !== "optional") {
    throw new Error(`--lost-stolen invalide : "${lostStolen}" (attendu : required ou optional)`);
  }

  const activeLiveness = options.get("active-liveness") ?? "required";
  if (activeLiveness !== "required" && activeLiveness !== "optional") {
    throw new Error(`--active-liveness invalide : "${activeLiveness}" (attendu : required ou optional)`);
  }

  return { clientId, trustLevels, fields, lostStolenCheckRequired: lostStolen === "required", activeLivenessRequired: activeLiveness === "required" };
}

async function main(): Promise<void> {
  const { clientId, trustLevels, fields, lostStolenCheckRequired, activeLivenessRequired } = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.kycClient.findUnique({ where: { clientId } });
    if (existing) {
      throw new Error(`Un client KYC "${clientId}" existe déjà (id=${existing.id})`);
    }

    const apiKey = KycClientService.generateApiKey();
    await prisma.kycClient.create({
      data: {
        clientId,
        apiKeyHash: KycClientService.hashApiKey(apiKey),
        acceptedTrustLevels: trustLevels,
        allowedFields: fields,
        lostStolenCheckRequired,
        activeLivenessRequired,
        active: true,
      },
    });

    process.stdout.write(
      [
        `Client KYC créé : ${clientId}`,
        `Niveaux de confiance acceptés : ${trustLevels.join(", ")}`,
        `Champs autorisés : ${fields.length > 0 ? fields.join(", ") : "(aucun — verdict/trustChain/anomalies uniquement)"}`,
        `Registre perdus/volés : ${lostStolenCheckRequired ? "exigé" : "non exigé"}`,
        `Vivacité active : ${activeLivenessRequired ? "exigée" : "non exigée"}`,
        "",
        "Clé API (à conserver en lieu sûr — ne sera plus jamais affichée) :",
        apiKey,
        "",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
