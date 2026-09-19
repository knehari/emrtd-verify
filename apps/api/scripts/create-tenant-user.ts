/**
 * Provisionnement d'un compte humain pour le portail tenant (apps/tenant-portal) — voir
 * docs/tenant-portal.md. Rattaché à un KycClient déjà existant (`--kyc-client-id`, l'identifiant
 * public stable, pas l'id interne) : la création d'un tenant reste une opération admin distincte
 * (create-kyc-client.ts), pas d'auto-inscription (voir docs/roadmap.md pour la décision retenue).
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api create-tenant-user -- \
 *     --kyc-client-id=acme-bank --email=ops@acme-bank.example --role=OWNER
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/security/password-hasher";

function parseArgs(argv: string[]): { kycClientId: string; email: string; role: "OWNER" | "MEMBER" } {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      options.set(match[1], match[2]);
    }
  }

  const kycClientId = options.get("kyc-client-id");
  if (!kycClientId) {
    throw new Error("--kyc-client-id=<identifiant> est requis (voir create-kyc-client.ts)");
  }

  const email = options.get("email");
  if (!email) {
    throw new Error("--email=<adresse> est requis");
  }

  const role = options.get("role") ?? "MEMBER";
  if (role !== "OWNER" && role !== "MEMBER") {
    throw new Error(`Rôle invalide : "${role}" (attendu : OWNER ou MEMBER)`);
  }

  return { kycClientId, email, role };
}

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const { kycClientId, email, role } = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const kycClient = await prisma.kycClient.findUnique({ where: { clientId: kycClientId } });
    if (!kycClient) {
      throw new Error(`Aucun client KYC "${kycClientId}" — le créer d'abord avec create-kyc-client.ts`);
    }

    const existing = await prisma.tenantUser.findUnique({ where: { email } });
    if (existing) {
      throw new Error(`Un compte tenant "${email}" existe déjà (id=${existing.id})`);
    }

    const temporaryPassword = generateTemporaryPassword();
    await prisma.tenantUser.create({
      data: {
        email,
        passwordHash: await hashPassword(temporaryPassword),
        // kycClient.clientId (identifiant public), pas kycClient.id — la FK TenantUser.kycClientId
        // référence KycClient.clientId (voir schema.prisma).
        kycClientId: kycClient.clientId,
        role,
        active: true,
      },
    });

    process.stdout.write(
      [
        `Compte tenant créé : ${email} (rôle ${role}, tenant ${kycClientId})`,
        "",
        "Mot de passe temporaire (à conserver en lieu sûr — ne sera plus jamais affiché) :",
        temporaryPassword,
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
