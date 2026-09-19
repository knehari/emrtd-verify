import { IsBoolean, IsIn, IsOptional } from "class-validator";

export class UpdateAdminUserDto {
  @IsOptional()
  @IsIn(["SUPER_ADMIN", "SUPPORT"])
  role?: "SUPER_ADMIN" | "SUPPORT";

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
