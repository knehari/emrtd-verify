/**
 * Déclenchement manuel de la synchronisation de la CSCA Master List ICAO PKD — utile pour le
 * bootstrap initial (avant que le job planifié quotidien n'ait tourné) ou pour resynchroniser
 * après mise à jour de config/master-list-signer-trust-anchors.json. Voir CscaSyncService.
 *
 * Usage : pnpm --filter @emrtd-verify/api sync-master-list
 */
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { CscaSyncService } from "../src/modules/pki/csca-sync.service";

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const config = new ConfigService();

  await prisma.$connect();
  try {
    const service = new CscaSyncService(prisma, config);
    const result = await service.sync();

    if (result.status === "failed") {
      process.stderr.write(`Synchronisation échouée : ${result.errorMessage}\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`Synchronisation réussie : ${result.certificateCount} CSCA importés.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
