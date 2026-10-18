import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  CreateFieldInput,
  ImportFieldsInput,
  SplitFieldInput,
  UpdateFieldGeometryInput,
  UpdateFieldInput,
  ValidateGeometryInput,
} from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { FieldPartsService } from './field-parts.service.js';
import { FieldsService } from './fields.service.js';

/** Part fields of all fields in a season, e.g. for maps. */
@Controller('orgs/:orgId/field-parts')
export class FieldPartsController {
  constructor(private readonly parts: FieldPartsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string, @Query('farmId') farmId?: string) {
    return this.parts.list(ctx, { seasonId, farmId });
  }
}

@Controller('orgs/:orgId/fields')
export class FieldsController {
  constructor(
    private readonly fields: FieldsService,
    private readonly parts: FieldPartsService,
  ) {}

  @Get()
  list(
    @OrgCtx() ctx: Ctx,
    @Query('farmId') farmId?: string,
    @Query('seasonId') seasonId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.fields.list(ctx, { farmId, seasonId, includeArchived: includeArchived === 'true' });
  }

  @Get('export.geojson')
  export(@OrgCtx() ctx: Ctx, @Query('farmId') farmId?: string) {
    return this.fields.export(ctx, farmId);
  }

  @Post('validate-geometry')
  validate(@OrgCtx() ctx: Ctx, @ZBody(ValidateGeometryInput) input: Out<typeof ValidateGeometryInput>) {
    return this.fields.validate(ctx, input.geometry, input.excludeFieldId);
  }

  @Post('import')
  @Requires('field.write')
  import(@OrgCtx() ctx: Ctx, @ZBody(ImportFieldsInput) input: Out<typeof ImportFieldsInput>) {
    return this.fields.import(ctx, input);
  }

  @Get(':id')
  get(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.get(ctx, id);
  }

  @Get(':id/parts')
  listParts(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query('seasonId') seasonId?: string) {
    return this.parts.list(ctx, { fieldId: id, seasonId });
  }

  @Put(':id/parts')
  @Requires('field.write')
  split(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SplitFieldInput) input: Out<typeof SplitFieldInput>) {
    return this.parts.split(ctx, id, input);
  }

  @Post(':id/parts/preview')
  previewSplit(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(SplitFieldInput) input: Out<typeof SplitFieldInput>) {
    return this.parts.preview(ctx, id, input);
  }

  @Get(':id/geometry-history')
  history(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.geometryHistory(ctx, id);
  }

  @Post()
  @Requires('field.write')
  create(@OrgCtx() ctx: Ctx, @ZBody(CreateFieldInput) input: Out<typeof CreateFieldInput>) {
    return this.fields.create(ctx, input);
  }

  @Patch(':id')
  @Requires('field.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateFieldInput) input: Out<typeof UpdateFieldInput>) {
    return this.fields.update(ctx, id, input);
  }

  @Put(':id/geometry')
  @Requires('field.write')
  updateGeometry(
    @OrgCtx() ctx: Ctx,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(UpdateFieldGeometryInput) input: Out<typeof UpdateFieldGeometryInput>,
  ) {
    return this.fields.updateGeometry(ctx, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.delete(ctx, id);
  }
}
