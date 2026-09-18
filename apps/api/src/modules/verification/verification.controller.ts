import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { VerificationService } from "./verification.service";
import { SubmitVerificationDto } from "./dto/submit-verification.dto";

@Controller("v1/verifications")
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(@Body() dto: SubmitVerificationDto) {
    return this.verificationService.submit(dto);
  }

  @Get(":verificationId")
  getResult(@Param("verificationId") verificationId: string) {
    return this.verificationService.getResult(verificationId);
  }
}
