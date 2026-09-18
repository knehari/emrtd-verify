import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  correlationId: string;
}

/**
 * Le corps d'erreur `@nestjs/terminus` (ServiceUnavailableException levée par
 * HealthCheckService.check()) porte le détail par dépendance dans `error`/`details`
 * (ex. { database: { status: "down" } }) — indispensable pour qu'un orchestrateur (ou un
 * humain en astreinte) sache QUELLE dépendance est en panne, à la différence d'une erreur
 * métier (PKI, vérification) dont le détail reste volontairement générique côté client.
 */
function terminusDetail(response: unknown): Record<string, unknown> | undefined {
  if (typeof response !== "object" || response === null) {
    return undefined;
  }
  const { error, details } = response as { error?: unknown; details?: unknown };
  if (typeof details === "object" && details !== null) {
    return details as Record<string, unknown>;
  }
  if (typeof error === "object" && error !== null) {
    return error as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Filtre global : point de sortie unique pour toute erreur non gérée. Ne renvoie jamais
 * la stack trace ni le détail interne au client (voir docs/threat-model.md — ne pas donner
 * d'information exploitable sur la chaîne de confiance PKI ou l'infrastructure interne à un
 * appelant potentiellement malveillant). Le detail complet part uniquement dans les logs,
 * corrélé par un identifiant que le client peut fournir en support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  // Logger standard NestJS plutôt qu'une PinoLogger injectée : une fois app.useLogger() appelé
  // dans main.ts avec le logger nestjs-pino, Logger délègue déjà vers Pino en interne — inutile
  // d'introduire une dépendance DI supplémentaire pour ce simple besoin de journalisation.
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const correlationId = (request?.headers?.["x-correlation-id"] as string | undefined) ?? randomUUID();

    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException ? this.extractMessage(exception) : "Erreur interne";

    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(
      `[${correlationId}] ${statusCode} ${request?.url ?? ""} — ${exception instanceof Error ? exception.message : String(exception)}`,
      stack,
    );

    const dependencies =
      exception instanceof HttpException ? terminusDetail(exception.getResponse()) : undefined;

    const body: ErrorResponseBody & { dependencies?: Record<string, unknown> } = {
      statusCode,
      message,
      correlationId,
      ...(dependencies ? { dependencies } : {}),
    };
    response.status(statusCode).send(body);
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === "string") {
      return response;
    }
    if (typeof response === "object" && response !== null && "message" in response) {
      const { message } = response as { message: string | string[] };
      return Array.isArray(message) ? message.join("; ") : message;
    }
    return exception.message;
  }
}
