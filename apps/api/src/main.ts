import "reflect-metadata";
// Enregistre le repli ECDSA Brainpool (node:crypto) — plus importé automatiquement par
// @emrtd-verify/pki-trust (son point d'entrée est désormais portable, voir
// packages/pki-trust/src/index.ts et docs/pki-trust-model.md "Vérification hors ligne").
import "@emrtd-verify/pki-trust/src/nodeCryptoFallback";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  // bufferLogs: true — tamponne les logs de démarrage jusqu'à ce que le logger Pino (fourni
  // par nestjs-pino, asynchrone) soit prêt, pour ne perdre aucune ligne émise avant useLogger().
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await app.register(helmet);
  await app.register(compress);
  // Requis par AdminAuthGuard/TenantAuthGuard (cookies de session httpOnly) — voir
  // modules/admin-auth et modules/tenant-auth. Pas de secret de signature ici : le contenu du
  // cookie est déjà un JWT signé (voir AdminAuthService/TenantAuthService), une double signature
  // n'apporterait rien.
  await app.register(cookie);

  // apps/admin-web et apps/tenant-portal tournent sur des origines distinctes de l'API (voir
  // docs/admin-web.md, docs/tenant-portal.md) — credentials: true est nécessaire pour que le
  // navigateur envoie le cookie de session, ce qui interdit `origin: "*"` (spec CORS), d'où une
  // liste explicite d'origines autorisées.
  const allowedOrigins = [process.env.ADMIN_WEB_ORIGIN, process.env.TENANT_PORTAL_ORIGIN].filter(
    (origin): origin is string => Boolean(origin),
  );
  app.enableCors({ origin: allowedOrigins, credentials: true });

  // transform: true — nécessaire pour que `@Type(() => Number)` (voir
  // ListVerificationsQueryDto) coerce réellement les paramètres de requête (toujours des
  // chaînes en HTTP) vers le type attendu par le DTO, en plus de la validation whitelist déjà
  // en place.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
}

bootstrap();
