import { IsString, MinLength } from "class-validator";

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1)
  password!: string;
}
