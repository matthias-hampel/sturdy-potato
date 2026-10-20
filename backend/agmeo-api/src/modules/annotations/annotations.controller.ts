import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AnnotationInput, AnnotationPatch } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { AnnotationsService } from './annotations.service.js';

/** Notes drawn on a field's satellite scenes. */
@Controller('orgs/:orgId/fields/:fieldId/annotations')
export class AnnotationsController {
  constructor(private readonly annotations: AnnotationsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Query('date') date?: string) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
    return this.annotations.list(ctx, fieldId, { date });
  }

  @Post()
  @Requires('field.write')
  create(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(AnnotationInput) input: Out<typeof AnnotationInput>) {
    return this.annotations.create(ctx, fieldId, input);
  }

  @Patch(':id')
  @Requires('field.write')
  update(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(AnnotationPatch) patch: Out<typeof AnnotationPatch>,
  ) {
    return this.annotations.update(ctx, fieldId, id, patch);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('field.write')
  remove(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.annotations.remove(ctx, fieldId, id);
  }
}
