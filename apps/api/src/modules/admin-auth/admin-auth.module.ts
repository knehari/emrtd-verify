import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminRolesGuard } from "./admin-roles.guard";

/**
 * Authentification des administrateurs internes SaaS — voir docs/admin-web.md. `JwtModule` est
 * enregistré ICI (pas globalement) avec `ADMIN_JWT_SECRET`, un secret distinct de celui de
 * TenantAuthModule (`TENANT_JWT_SECRET`) : un jeton admin ne doit jamais pouvoir être rejoué
 * comme jeton tenant même en cas de bug de vérification, et une rotation de l'un n'invalide
 * jamais les sessions de l'autre.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("ADMIN_JWT_SECRET");
        if (!secret) {
          throw new Error("ADMIN_JWT_SECRET non configuré — requis pour l'authentification admin (apps/admin-web)");
        }
        return { secret, signOptions: { expiresIn: "12h" } };
      },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, AdminRolesGuard],
  exports: [AdminAuthService, AdminAuthGuard, AdminRolesGuard],
})
export class AdminAuthModule {}
