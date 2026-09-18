import { Module } from "@nestjs/common";
import { KycController } from "./kyc.controller";
import { KycService } from "./kyc.service";
import { KycClientService } from "./kyc-client.service";
import { KycApiKeyGuard } from "./kyc-api-key.guard";

@Module({
  controllers: [KycController],
  providers: [KycService, KycClientService, KycApiKeyGuard],
  exports: [KycService, KycClientService, KycApiKeyGuard],
})
export class KycModule {}
