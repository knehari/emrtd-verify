/**
 * Modifie la politique d'un client KYC existant sans passer par l'API d'administration (qui exige
 * un compte administrateur) — utile en local. Même effet que PATCH /admin/kyc-clients/:clientId.
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api update-kyc-client -- --client-id=acme-bank --lost-stolen=optional
 *
 * --lost-stolen=optional : registre des documents perdus/volés non exigé (un registre non
 * interrogé devient une simple information) ; required : exigé (défaut à la création).
 * --active-liveness=optional : vivacité active non exigée (une vivacité seulement passive devient
 * une simple information) ; required : exigée (défaut à la création). Au moins une des deux options.
 * --client-id insensible à la casse ; omis, le seul client existant est pris.
 */
import { PrismaClient } from "@prisma/client";

function parseFlag(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value !== "required" && value !== "optional") throw new Error(`--${name}=required|optional attendu`);
  return value === "required";
}

function parseArgs(argv: string[]): { clientId?: string; lostStolenCheckRequired?: boolean; activeLivenessRequired?: boolean } {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      options.set(match[1], match[2]);
    }
  }

  const clientId = options.get("client-id") || undefined;
  const lostStolenCheckRequired = parseFlag(options.get("lost-stolen"), "lost-stolen");
  const activeLivenessRequired = parseFlag(options.get("active-liveness"), "active-liveness");
  if (lostStolenCheckRequired === undefined && activeLivenessRequired === undefined) {
    throw new Error("--lost-stolen=required|optional et/ou --active-liveness=required|optional attendu");
  }
  return { clientId, lostStolenCheckRequired, activeLivenessRequired };
}

async function main(): Promise<void> {
  const { clientId, lostStolenCheckRequired, activeLivenessRequired } = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const clients = await prisma.kycClient.findMany({ select: { clientId: true }, orderBy: { createdAt: "asc" } });
    const known = clients.map((c) => c.clientId);
    const target = clientId
      ? known.find((id) => id.toLowerCase() === clientId.toLowerCase())
      : known.length === 1
        ? known[0]
        : undefined;
    if (!target) {
      const list = known.length > 0 ? known.join(", ") : "aucun (créez-en un : scripts/serveur-local.sh client)";
      throw new Error(clientId ? `Aucun client KYC "${clientId}" — clients existants : ${list}` : `Précisez le client — clients existants : ${list}`);
    }
    const updated = await prisma.kycClient.update({ where: { clientId: target }, data: { lostStolenCheckRequired, activeLivenessRequired } });
    process.stdout.write(
      `Client KYC ${target} : registre perdus/volés ${updated.lostStolenCheckRequired ? "exigé" : "non exigé"}, ` +
        `vivacité active ${updated.activeLivenessRequired ? "exigée" : "non exigée"}.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
