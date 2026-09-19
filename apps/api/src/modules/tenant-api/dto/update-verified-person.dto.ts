import { IsIn, IsString, MaxLength, ValidateIf } from "class-validator";

export class UpdateVerifiedPersonDto {
  @IsIn(["VERIFIED", "UNVERIFIED", "PENDING_REVIEW", "WATCHLIST"])
  status!: "VERIFIED" | "UNVERIFIED" | "PENDING_REVIEW" | "WATCHLIST";

  /**
   * Requis quand `status = WATCHLIST` — une mise sous surveillance doit toujours être motivée
   * (voir docs/tenant-portal.md). Ignoré pour tout autre statut (ValidateIf saute la validation).
   */
  @ValidateIf((dto: UpdateVerifiedPersonDto) => dto.status === "WATCHLIST")
  @IsString()
  @MaxLength(500)
  watchlistReason?: string;
}
