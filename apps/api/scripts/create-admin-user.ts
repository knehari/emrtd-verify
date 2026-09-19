/**
 * Provisionnement d'un administrateur interne SaaS (apps/admin-web) — jamais via un endpoint
 * HTTP public, même principe que create-kyc-client.ts. Un mot de passe temporaire à haute
 * entropie est généré et affiché une seule fois ; l'administrateur devra le changer à la
 * première connexion (voir docs/admin-web.md — changement de mot de passe non encore implémenté
 * en v1, limite assumée documentée dans docs/roadmap.md).
 *
 * Usage :
 *   pnpm --filter @emrtd-verify/api create-admin-user -- \
 *     --email=ops@example.org --role=SUPER_ADMIN
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/common/security/password-hasher";

function parseArgs(argv: string[]): { email: string; role: "SUPER_ADMIN" | "SUPPORT" } {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      options.set(match[1], match[2]);
    }
  }

  const email = options.get("email");
  if (!email) {
    throw new Error("--email=<adresse> est requis");
  }

  const role = options.get("role") ?? "SUPPORT";
  if (role !== "SUPER_ADMIN" && role !== "SUPPORT") {
    throw new Error(`Rôle invalide : "${role}" (attendu : SUPER_ADMIN ou SUPPORT)`);
  }

  return { email, role };
}

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const { email, role } = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      throw new Error(`Un administrateur "${email}" existe déjà (id=${existing.id})`);
    }

    const temporaryPassword = generateTemporaryPassword();
    await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await hashPassword(temporaryPassword),
        role,
        active: true,
      },
    });

    process.stdout.write(
      [
        `Administrateur créé : ${email} (rôle ${role})`,
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
