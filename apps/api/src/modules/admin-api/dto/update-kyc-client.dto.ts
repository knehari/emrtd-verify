import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class UpdateKycClientDto {
  @IsOptional()
  @IsArray()
  @IsIn(["high", "medium", "low"], { each: true })
  acceptedTrustLevels?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedFields?: string[];

  @IsOptional()
  @IsBoolean()
  lostStolenCheckRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  activeLivenessRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
