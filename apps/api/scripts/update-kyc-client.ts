/**
 * Modifie la politique d'un client KYC existant sans passer par l'API d'administration (qui exige
 * un compte administrateur) — utile en local. Même effet que PATCH /admin/kyc-clients/:clientId.
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api update-kyc-client -- --client-id=acme-bank --lost-stolen=optional
 *
 * --lost-stolen=optional : registre des documents perdus/volés non exigé (un registre non
 * interrogé devient une simple information) ; required : exigé (défaut à la création).
 * --client-id insensible à la casse ; omis, le seul client existant est pris.
 */
import { PrismaClient } from "@prisma/client";

function parseArgs(argv: string[]): { clientId?: string; lostStolenCheckRequired: boolean } {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      options.set(match[1], match[2]);
    }
  }

  const clientId = options.get("client-id") || undefined;
  const lostStolen = options.get("lost-stolen");
  if (lostStolen !== "required" && lostStolen !== "optional") {
    throw new Error("--lost-stolen=required|optional est requis");
  }
  return { clientId, lostStolenCheckRequired: lostStolen === "required" };
}

async function main(): Promise<void> {
  const { clientId, lostStolenCheckRequired } = parseArgs(process.argv.slice(2));

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
    await prisma.kycClient.update({ where: { clientId: target }, data: { lostStolenCheckRequired } });
    process.stdout.write(`Client KYC ${target} : registre perdus/volés ${lostStolenCheckRequired ? "exigé" : "non exigé"}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
