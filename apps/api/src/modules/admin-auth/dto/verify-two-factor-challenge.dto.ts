import { IsNumberString, IsString, Length } from "class-validator";

export class VerifyTwoFactorChallengeDto {
  @IsString()
  challengeToken!: string;

  @IsNumberString()
  @Length(6, 6)
  code!: string;
}
