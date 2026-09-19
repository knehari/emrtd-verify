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
  active?: boolean;
}
