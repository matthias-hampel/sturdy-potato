import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { EmployeeInput, EquipmentInput, MaintenanceInput, OperationActionInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { catalogueManufacturers, catalogueSearch } from './machinery-catalogue.js';
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
  equipment(@OrgCtx() ctx: Ctx, @Query('includeArchived') includeArchived?: string) {
    return this.team.equipment(ctx, { includeArchived: includeArchived === 'true' });
  }

  @Get('machinery-catalogue/manufacturers')
  catalogueManufacturers(@OrgCtx() _ctx: Ctx, @Query('class') cls?: string) {
    return catalogueManufacturers(catalogueClass(cls));
  }

  @Get('machinery-catalogue')
  catalogue(@OrgCtx() _ctx: Ctx, @Query('class') cls?: string, @Query('manufacturer') manufacturer?: string, @Query('q') q?: string) {
    return catalogueSearch(catalogueClass(cls), { manufacturer, q, limit: 200 });
  }

  @Get('operation-actions')
  actions(@OrgCtx() ctx: Ctx, @Query('includeArchived') includeArchived?: string) {
    return this.team.actions(ctx, { includeArchived: includeArchived === 'true' });
  }

  @Post('operation-actions')
  @Requires('machinery.write')
  createAction(@OrgCtx() ctx: Ctx, @ZBody(OperationActionInput) input: Out<typeof OperationActionInput>) {
    return this.team.createAction(ctx, input);
  }

  @Put('operation-actions/:id')
  @Requires('machinery.write')
  updateAction(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(OperationActionInput) input: Out<typeof OperationActionInput>) {
    return this.team.updateAction(ctx, id, input);
  }

  @Delete('operation-actions/:id')
  @Requires('machinery.write')
  deleteAction(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.deleteAction(ctx, id);
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

function catalogueClass(v?: string): 'machine' | 'implement' {
  if (v === 'machine' || v === 'implement') return v;
  throw badRequest('invalid_class', 'class must be machine or implement');
}
