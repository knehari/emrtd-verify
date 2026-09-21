import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

/** Décision humaine clôturant un cas de revue manuelle — voir AdminVerificationsService.review. */
export class ReviewVerificationDto {
  @IsIn(["CONFIRMED_AUTHENTIC", "CONFIRMED_REJECTED", "ESCALATED"])
  outcome!: "CONFIRMED_AUTHENTIC" | "CONFIRMED_REJECTED" | "ESCALATED";

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
