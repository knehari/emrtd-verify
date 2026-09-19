import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TenantAuthController } from "./tenant-auth.controller";
import { TenantAuthService } from "./tenant-auth.service";
import { TenantAuthGuard } from "./tenant-auth.guard";

/**
 * Authentification des comptes tenant (apps/tenant-portal) — voir docs/tenant-portal.md.
 * `TENANT_JWT_SECRET` distinct de `ADMIN_JWT_SECRET` (voir AdminAuthModule) : isolation des
 * deux systèmes de session, une rotation de l'un n'affecte jamais l'autre.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("TENANT_JWT_SECRET");
        if (!secret) {
          throw new Error("TENANT_JWT_SECRET non configuré — requis pour l'authentification tenant (apps/tenant-portal)");
        }
        return { secret, signOptions: { expiresIn: "12h" } };
      },
    }),
  ],
  controllers: [TenantAuthController],
  providers: [TenantAuthService, TenantAuthGuard],
  exports: [TenantAuthService, TenantAuthGuard],
})
export class TenantAuthModule {}
