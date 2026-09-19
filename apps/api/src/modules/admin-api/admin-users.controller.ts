import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard, RequireAdminRole } from "../admin-auth/admin-roles.guard";
import { AdminUsersService } from "./admin-users.service";
import { CreateAdminUserDto } from "./dto/create-admin-user.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

/** Gestion des comptes administrateurs internes — réservée à SUPER_ADMIN pour toute écriture. */
@Controller("admin/admin-users")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @RequireAdminRole("SUPER_ADMIN")
  @Post()
  create(@Body() dto: CreateAdminUserDto) {
    return this.service.create(dto);
  }

  @RequireAdminRole("SUPER_ADMIN")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAdminUserDto) {
    return this.service.update(id, dto);
  }
}
