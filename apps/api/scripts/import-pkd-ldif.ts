/**
 * Import manuel d'un export LDIF ICAO PKD (Master Lists nationales, branche `o=ml,c=XX`) —
 * voir packages/pki-trust/src/pkdLdif.ts et docs/pki-trust-model.md "Ingestion LDIF".
 *
 * Ce fichier doit être obtenu par l'opérateur lui-même : le portail de téléchargement ICAO PKD
 * (https://pkddownload.icao.int/downloads) impose un captcha et consigne l'IP du téléchargement —
 * volontairement non automatisé ici (voir docs/pki-trust-model.md). Un accès LDAP enregistré
 * (packages/pki-trust/src/pkdClient.ts) reste la seule voie ICAO-sanctionnée pour l'automatisation.
 *
 * Usage : pnpm --filter @emrtd-verify/api import-pkd-ldif <chemin-vers-export.ldif>
 */
import { readFileSync } from "node:fs";
import { ConfigService } from "@nestjs/config";
import { parsePkdLdifMasterLists } from "@emrtd-verify/pki-trust";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { CscaSyncService } from "../src/modules/pki/csca-sync.service";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("Usage : pnpm --filter @emrtd-verify/api import-pkd-ldif <chemin-vers-export.ldif>\n");
    process.exitCode = 1;
    return;
  }

  const ldifText = readFileSync(path, "latin1");
  const entries = parsePkdLdifMasterLists(ldifText);
  process.stdout.write(`${entries.length} entrée(s) Master List nationale trouvée(s) dans ${path}.\n`);

  const prisma = new PrismaService();
  const config = new ConfigService();

  await prisma.$connect();
  try {
    const service = new CscaSyncService(prisma, config);
    const result = await service.syncCountryMasterLists(entries);

    if (result.status === "failed") {
      process.stderr.write(`Import échoué : ${result.errorMessage}\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`Import réussi : ${result.validatedCountries} pays validés, ${result.skippedCountries} ignorés.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
