import { IsArray, IsBase64, IsEnum, IsOptional, IsString } from "class-validator";
import type { DocumentType } from "@emrtd-verify/shared-types";

export class SubmitVerificationDto {
  @IsEnum(["eID", "ePassport", "eResidenceCard"])
  documentType!: DocumentType;

  @IsBase64()
  chipData!: string;

  @IsOptional()
  @IsBase64()
  liveCapture?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requestedFields?: string[];
}
