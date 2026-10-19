import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ArchiveFieldsInput,
  CreateFieldInput,
  FieldGroupInput,
  FieldGroupMembersInput,
  FieldIdsInput,
  ImportFieldsInput,
  MergeFieldsInput,
  RenumberFieldsInput,
  RestoreFieldGeometryInput,
  SplitFieldInput,
  UpdateFieldGeometryInput,
  UpdateFieldInput,
  ValidateGeometryInput,
} from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { FieldGroupsService } from './field-groups.service.js';
import { FieldManagementService } from './field-management.service.js';
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

@Controller('orgs/:orgId/field-groups')
export class FieldGroupsController {
  constructor(private readonly groups: FieldGroupsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx) {
    return this.groups.list(ctx);
  }

  @Post()
  @Requires('field.write')
  create(@OrgCtx() ctx: Ctx, @ZBody(FieldGroupInput) input: Out<typeof FieldGroupInput>) {
    return this.groups.create(ctx, input);
  }

  @Post('members')
  @Requires('field.write')
  addMembers(@OrgCtx() ctx: Ctx, @ZBody(FieldGroupMembersInput) input: Out<typeof FieldGroupMembersInput>) {
    return this.groups.addMembers(ctx, input);
  }

  @Post('members/remove')
  @Requires('field.write')
  removeMembers(@OrgCtx() ctx: Ctx, @ZBody(FieldGroupMembersInput) input: Out<typeof FieldGroupMembersInput>) {
    return this.groups.removeMembers(ctx, input);
  }

  @Patch(':id')
  @Requires('field.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(FieldGroupInput.partial()) input: Partial<Out<typeof FieldGroupInput>>) {
    return this.groups.update(ctx, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.delete(ctx, id);
  }
}

@Controller('orgs/:orgId/fields')
export class FieldsController {
  constructor(
    private readonly fields: FieldsService,
    private readonly parts: FieldPartsService,
    private readonly management: FieldManagementService,
  ) {}

  @Get()
  list(
    @OrgCtx() ctx: Ctx,
    @Query('farmId') farmId?: string,
    @Query('seasonId') seasonId?: string,
    @Query('groupId') groupId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.fields.list(ctx, { farmId, seasonId, groupId: groupId || undefined, includeArchived: includeArchived === 'true' });
  }

  @Post('archive')
  @Requires('field.write')
  archive(@OrgCtx() ctx: Ctx, @ZBody(ArchiveFieldsInput) input: Out<typeof ArchiveFieldsInput>) {
    return this.management.archive(ctx, input);
  }

  @Post('restore')
  @Requires('field.write')
  restore(@OrgCtx() ctx: Ctx, @ZBody(FieldIdsInput) input: Out<typeof FieldIdsInput>) {
    return this.management.restore(ctx, input);
  }

  @Post('delete')
  @Requires('field.write')
  deleteMany(@OrgCtx() ctx: Ctx, @ZBody(FieldIdsInput) input: Out<typeof FieldIdsInput>) {
    return this.management.deleteMany(ctx, input);
  }

  @Post('renumber')
  @HttpCode(204)
  @Requires('field.write')
  renumber(@OrgCtx() ctx: Ctx, @ZBody(RenumberFieldsInput) input: Out<typeof RenumberFieldsInput>) {
    return this.management.renumber(ctx, input);
  }

  @Post('merge/preview')
  @Requires('field.write')
  mergePreview(@OrgCtx() ctx: Ctx, @ZBody(MergeFieldsInput) input: Out<typeof MergeFieldsInput>) {
    return this.management.mergePreview(ctx, input);
  }

  @Post('merge')
  @Requires('field.write')
  merge(@OrgCtx() ctx: Ctx, @ZBody(MergeFieldsInput) input: Out<typeof MergeFieldsInput>) {
    return this.management.merge(ctx, input);
  }

  @Post(':id/geometry/restore')
  @Requires('field.write')
  restoreGeometry(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(RestoreFieldGeometryInput) input: Out<typeof RestoreFieldGeometryInput>) {
    return this.management.restoreGeometry(ctx, id, input);
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

  @Delete(':id/geometry/:versionId')
  @Requires('field.write')
  cancelPlannedGeometry(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.fields.cancelPlannedGeometry(ctx, id, versionId);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('field.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.delete(ctx, id);
  }
}
