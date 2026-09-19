import { IsEmail, IsIn } from "class-validator";

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsIn(["SUPER_ADMIN", "SUPPORT"])
  role!: "SUPER_ADMIN" | "SUPPORT";
}
