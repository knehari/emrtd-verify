import { IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  /** Seuil plus élevé que la connexion (8) — nudge vers un mot de passe plus robuste au changement. */
  @IsString()
  @MinLength(12)
  newPassword!: string;
}
