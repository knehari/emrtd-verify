import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * @Global() : PrismaService est consommé par de nombreux modules non liés entre eux
 * (audit, verification, health) — l'enregistrer une seule fois évite une ré-importation
 * répétitive de PrismaModule partout, pattern standard pour un client de base de données.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
