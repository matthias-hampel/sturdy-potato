import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApplyTemplateInput, AssignRotationInput, CalendarYearsQuery, CarryForwardInput, CopyTemplateInput, RollOverInput, RotationInput, SaveAsTemplateInput, TemplateInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { PlanningService } from './planning.service.js';

@Controller('orgs/:orgId')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('templates')
  templates(@OrgCtx() ctx: Ctx) {
    return this.planning.templates(ctx);
  }

  /** Templates of the user's other organizations, read-only. */
  @Get('templates/shared')
  sharedTemplates(@OrgCtx() ctx: Ctx) {
    return this.planning.sharedTemplates(ctx);
  }

  @Post('templates/:id/copy')
  @Requires('crop.write')
  copyTemplate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CopyTemplateInput) input: Out<typeof CopyTemplateInput>) {
    return this.planning.copyTemplate(ctx, id, input);
  }

  @Post('crop-cycles/:id/save-as-template')
  @Requires('crop.write')
  saveAsTemplate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SaveAsTemplateInput) input: Out<typeof SaveAsTemplateInput>) {
    return this.planning.saveCycleAsTemplate(ctx, id, input);
  }

  @Get('templates/:id')
  template(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.template(ctx, id);
  }

  @Post('templates')
  @Requires('crop.write')
  createTemplate(@OrgCtx() ctx: Ctx, @ZBody(TemplateInput) input: Out<typeof TemplateInput>) {
    return this.planning.createTemplate(ctx, input);
  }

  @Put('templates/:id')
  @Requires('crop.write')
  updateTemplate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(TemplateInput) input: Out<typeof TemplateInput>) {
    return this.planning.updateTemplate(ctx, id, input);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @Requires('crop.write')
  deleteTemplate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.deleteTemplate(ctx, id);
  }

  @Post('crop-cycles/:id/apply-template')
  @Requires('operation.write')
  applyTemplate(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ApplyTemplateInput) input: Out<typeof ApplyTemplateInput>) {
    return this.planning.applyTemplate(ctx, id, input);
  }

  @Get('rotations')
  rotations(@OrgCtx() ctx: Ctx) {
    return this.planning.rotations(ctx);
  }

  @Post('rotations')
  @Requires('crop.write')
  createRotation(@OrgCtx() ctx: Ctx, @ZBody(RotationInput) input: Out<typeof RotationInput>) {
    return this.planning.createRotation(ctx, input);
  }

  @Put('rotations/:id')
  @Requires('crop.write')
  updateRotation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(RotationInput) input: Out<typeof RotationInput>) {
    return this.planning.updateRotation(ctx, id, input);
  }

  @Delete('rotations/:id')
  @HttpCode(204)
  @Requires('crop.write')
  deleteRotation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.deleteRotation(ctx, id);
  }

  @Post('rotations/:id/fields')
  @Requires('crop.write')
  assignRotation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(AssignRotationInput) input: Out<typeof AssignRotationInput>) {
    return this.planning.assignRotation(ctx, id, input);
  }

  @Delete('rotation-assignments/:id')
  @HttpCode(204)
  @Requires('crop.write')
  unassignRotation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.unassignRotation(ctx, id);
  }

  @Post('crop-cycles/carry-forward')
  @Requires('crop.write')
  carryForward(@OrgCtx() ctx: Ctx, @ZBody(CarryForwardInput) input: Out<typeof CarryForwardInput>) {
    return this.planning.carryForward(ctx, input);
  }

  @Post('rotations/roll-over')
  @Requires('crop.write')
  rollOver(@OrgCtx() ctx: Ctx, @ZBody(RollOverInput) input: Out<typeof RollOverInput>) {
    return this.planning.rollOver(ctx, input);
  }

  @Get('crop-calendar/years')
  calendarYears(@OrgCtx() ctx: Ctx, @ZQuery(CalendarYearsQuery) query: Out<typeof CalendarYearsQuery>) {
    return this.planning.calendarYears(ctx, query);
  }

  @Get('crop-calendar')
  calendar(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    return this.planning.calendar(ctx, seasonId);
  }
}
