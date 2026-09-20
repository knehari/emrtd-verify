import { IsNumberString, Length } from "class-validator";

export class TwoFactorCodeDto {
  @IsNumberString()
  @Length(6, 6)
  code!: string;
}
