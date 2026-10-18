import { Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { EmployeeInput, EquipmentInput, MaintenanceInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { TeamService } from './team.service.js';

@Controller('orgs/:orgId')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('employees')
  employees(@OrgCtx() ctx: Ctx) {
    return this.team.employees(ctx);
  }

  @Post('employees')
  @Requires('team.write')
  createEmployee(@OrgCtx() ctx: Ctx, @ZBody(EmployeeInput) input: Out<typeof EmployeeInput>) {
    return this.team.createEmployee(ctx, input);
  }

  @Put('employees/:id')
  @Requires('team.write')
  updateEmployee(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(EmployeeInput) input: Out<typeof EmployeeInput>) {
    return this.team.updateEmployee(ctx, id, input);
  }

  @Get('equipment')
  equipment(@OrgCtx() ctx: Ctx) {
    return this.team.equipment(ctx);
  }

  @Get('equipment/:id')
  getEquipment(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.getEquipment(ctx, id);
  }

  @Post('equipment')
  @Requires('machinery.write')
  createEquipment(@OrgCtx() ctx: Ctx, @ZBody(EquipmentInput) input: Out<typeof EquipmentInput>) {
    return this.team.createEquipment(ctx, input);
  }

  @Put('equipment/:id')
  @Requires('machinery.write')
  updateEquipment(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(EquipmentInput) input: Out<typeof EquipmentInput>) {
    return this.team.updateEquipment(ctx, id, input);
  }

  @Get('equipment/:id/maintenance')
  maintenance(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.maintenance(ctx, id);
  }

  @Post('equipment/:id/maintenance')
  @Requires('machinery.write')
  addMaintenance(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(MaintenanceInput) input: Out<typeof MaintenanceInput>) {
    return this.team.addMaintenance(ctx, id, input);
  }

  @Get('equipment/:id/usage')
  usage(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.usage(ctx, id);
  }
}
