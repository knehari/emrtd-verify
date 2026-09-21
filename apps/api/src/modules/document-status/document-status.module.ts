import { Module } from "@nestjs/common";
import { DocumentStatusService } from "./document-status.service";

/** Voir DocumentStatusService. Consommé par VerificationWorkerModule (VerificationProcessor). */
@Module({
  providers: [DocumentStatusService],
  exports: [DocumentStatusService],
})
export class DocumentStatusModule {}
