import { Type } from "class-transformer";
import { IsArray, IsBase64, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import type { DocumentType } from "@emrtd-verify/shared-types";
import { ActiveLivenessResponseDto } from "./active-liveness-response.dto";

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

  /** Réponse au challenge de liveness active (voir POST /v1/verifications/liveness-challenge et docs/facial-recognition.md) — optionnel : son absence dégrade vers la liveness passive uniquement (voir VerificationProcessor). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ActiveLivenessResponseDto)
  activeLiveness?: ActiveLivenessResponseDto;
}
