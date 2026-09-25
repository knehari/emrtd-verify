import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches } from "class-validator";

export class CreateKycClientDto {
  @IsString()
  @Matches(/^[a-z0-9-]{3,64}$/, { message: "clientId : minuscules/chiffres/tirets uniquement, 3 à 64 caractères" })
  clientId!: string;

  @IsArray()
  @IsIn(["high", "medium", "low"], { each: true })
  acceptedTrustLevels!: string[];

  @IsArray()
  @IsString({ each: true })
  allowedFields!: string[];

  /** Registre perdus/volés exigé (défaut : oui). */
  @IsOptional()
  @IsBoolean()
  lostStolenCheckRequired?: boolean;
}
