import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { VerificationModule } from "./modules/verification/verification.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { AuditModule } from "./modules/audit/audit.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), VerificationModule, KycModule, AuditModule],
})
export class AppModule {}
