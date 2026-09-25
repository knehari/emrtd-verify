/**
 * Modifie la politique d'un client KYC existant sans passer par l'API d'administration (qui exige
 * un compte administrateur) — utile en local. Même effet que PATCH /admin/kyc-clients/:clientId.
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api update-kyc-client -- --client-id=acme-bank --lost-stolen=optional
 *
 * --lost-stolen=optional : registre des documents perdus/volés non exigé (un registre non
 * interrogé devient une simple information) ; required : exigé (défaut à la création).
 */
import { PrismaClient } from "@prisma/client";

function parseArgs(argv: string[]): { clientId: string; lostStolenCheckRequired: boolean } {
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
    const existing = await prisma.kycClient.findUnique({ where: { clientId } });
    if (!existing) {
      throw new Error(`Aucun client KYC "${clientId}"`);
    }
    await prisma.kycClient.update({ where: { clientId }, data: { lostStolenCheckRequired } });
    process.stdout.write(`Client KYC ${clientId} : registre perdus/volés ${lostStolenCheckRequired ? "exigé" : "non exigé"}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
