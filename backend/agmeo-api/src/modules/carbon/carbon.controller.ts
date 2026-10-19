import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CARBON_LEVELS,
  CarbonSettingsInput,
  CarbonSoilInput,
  type CarbonLevel,
  RothCInput,
  Scope2Input,
} from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { CarbonService } from './carbon.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function years(value?: string): number[] | undefined {
  if (!value) return undefined;
  const out = value.split(',').map((v) => Number(v.trim()));
  if (out.some((y) => !Number.isInteger(y) || y < 1990 || y > 2200))
    throw badRequest(
      'invalid_years',
      'Years must be a comma-separated list of harvest years',
    );
  return out;
}

/** Greenhouse-gas balance (BEK), farm comparison, scope 2 and the soil-carbon simulation. */
@Controller('orgs/:orgId')
export class CarbonController {
  constructor(private readonly carbon: CarbonService) {}

  @Get('carbon/analysis')
  analysis(
    @OrgCtx() ctx: Ctx,
    @Query('level') level?: string,
    @Query('years') y?: string,
  ) {
    const l = (level ?? 'crop') as CarbonLevel;
    if (!(CARBON_LEVELS as readonly string[]).includes(l))
      throw badRequest('invalid_level', 'Unknown level');
    return this.carbon.analysis(ctx, l, years(y));
  }

  /** Crop-level analysis of this and other organizations of the user, side by side. */
  @Get('carbon/comparison')
  comparison(
    @OrgCtx() ctx: Ctx,
    @Query('orgIds') orgIds?: string,
    @Query('years') y?: string,
  ) {
    const ids = (orgIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 50 || ids.some((id) => !UUID.test(id)))
      throw badRequest(
        'invalid_org_ids',
        'orgIds must be up to 50 organization ids',
      );
    return this.carbon.comparison(ctx, ids, years(y));
  }

  @Get('carbon/organizations')
  organizations(@OrgCtx() ctx: Ctx) {
    return this.carbon.organizations(ctx);
  }

  @Get('carbon/settings')
  settings(@OrgCtx() ctx: Ctx) {
    return this.carbon.settings(ctx);
  }

  @Put('carbon/settings')
  @Requires('farm.write')
  saveSettings(
    @OrgCtx() ctx: Ctx,
    @ZBody(CarbonSettingsInput) input: Out<typeof CarbonSettingsInput>,
  ) {
    return this.carbon.saveSettings(ctx, input);
  }

  @Get('carbon/scope2')
  scope2(
    @OrgCtx() ctx: Ctx,
    @Query('harvestYear', ParseIntPipe) harvestYear: number,
  ) {
    return this.carbon.scope2(ctx, harvestYear);
  }

  @Put('carbon/scope2')
  @Requires('farm.write')
  saveScope2(
    @OrgCtx() ctx: Ctx,
    @ZBody(Scope2Input) input: Out<typeof Scope2Input>,
  ) {
    return this.carbon.saveScope2(ctx, input);
  }

  @Get('carbon/rotations/:id')
  rotation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.carbon.rotationCarbon(ctx, id);
  }

  @Get('fields/:fieldId/carbon/soil')
  soil(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string) {
    return this.carbon.soil(ctx, fieldId);
  }

  @Put('fields/:fieldId/carbon/soil')
  @Requires('field.write')
  saveSoil(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @ZBody(CarbonSoilInput) input: Out<typeof CarbonSoilInput>,
  ) {
    return this.carbon.saveSoil(ctx, fieldId, input);
  }

  @Delete('fields/:fieldId/carbon/soil')
  @HttpCode(204)
  @Requires('field.write')
  deleteSoil(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ) {
    return this.carbon.deleteSoil(ctx, fieldId);
  }

  /** Runs the Thünen RothC simulation for the field under a rotation (five weather windows, ~10–30 s). */
  @Post('fields/:fieldId/carbon/rothc')
  @HttpCode(200)
  rothc(
    @OrgCtx() ctx: Ctx,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @ZBody(RothCInput) input: Out<typeof RothCInput>,
  ) {
    return this.carbon.rothc(ctx, fieldId, input);
  }
}
