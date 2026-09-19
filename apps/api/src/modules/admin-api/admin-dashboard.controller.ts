import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { AdminDashboardService } from "./admin-dashboard.service";

@Controller("admin/dashboard")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get("stats")
  stats() {
    return this.service.stats();
  }
}
