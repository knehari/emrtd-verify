import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { RetentionSchedulerService } from "./retention-scheduler.service";

@Module({
  providers: [AuditService, RetentionSchedulerService],
  exports: [AuditService],
})
export class AuditModule {}
