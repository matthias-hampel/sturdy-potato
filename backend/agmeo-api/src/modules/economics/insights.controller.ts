import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { type CropBenchmark, CropBenchmarkInput, type CropMarketPrices, type MarketCommodity, type MarketQuote } from '@agmeo/contracts';
import { sql } from 'kysely';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { type Out, ZBody } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { CROP_COMMODITIES, SUPPORTED_MARKET_COUNTRIES } from './market-prices.js';
import { ProfitabilityService } from './profitability.service.js';

/** Profitability per field, benchmarks and market prices (economic analysis). */
@Controller('orgs/:orgId/economics')
export class EconomicsInsightsController {
  constructor(
    private readonly db: Database,
    private readonly profitability: ProfitabilityService,
  ) {}

  @Get('profitability')
  @Requires('finance.read')
  farm(@OrgCtx() ctx: Ctx, @Query('seasonId') seasonId?: string) {
    return this.profitability.farm(ctx, seasonId);
  }

  @Get('profitability/years')
  @Requires('finance.read')
  years(@OrgCtx() ctx: Ctx, @Query('fromYear', ParseIntPipe) fromYear: number, @Query('toYear', ParseIntPipe) toYear: number) {
    if (toYear < fromYear || toYear - fromYear > 10) throw badRequest('invalid_years', 'Choose at most eleven years');
    return this.profitability.years(ctx, fromYear, toYear);
  }

  @Get('benchmarks')
  @Requires('finance.read')
  benchmarks(@OrgCtx() ctx: Ctx): Promise<CropBenchmark[]> {
    return this.db.run(ctx, (trx) => queryBenchmarks(trx));
  }

  @Post('benchmarks')
  @Requires('finance.write')
  createBenchmark(@OrgCtx() ctx: Ctx, @ZBody(CropBenchmarkInput) input: Out<typeof CropBenchmarkInput>): Promise<CropBenchmark> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('crop_benchmarks')
        .values({ organization_id: ctx.orgId, ...benchmarkValues(input) })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch(duplicate);
      await record(trx, ctx, { entityType: 'crop_benchmark', entityId: id, action: 'created', changes: { name: input.name } });
      return (await queryBenchmarks(trx, id))[0];
    });
  }

  @Put('benchmarks/:id')
  @Requires('finance.write')
  updateBenchmark(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(CropBenchmarkInput) input: Out<typeof CropBenchmarkInput>): Promise<CropBenchmark> {
    return this.db.run(ctx, async (trx) => {
      const r = await trx.updateTable('crop_benchmarks').set(benchmarkValues(input)).where('id', '=', id).executeTakeFirst().catch(duplicate);
      if (!Number(r.numUpdatedRows)) throw notFound('Benchmark');
      await record(trx, ctx, { entityType: 'crop_benchmark', entityId: id, action: 'updated', changes: { name: input.name } });
      return (await queryBenchmarks(trx, id))[0];
    });
  }

  @Delete('benchmarks/:id')
  @HttpCode(204)
  @Requires('finance.write')
  deleteBenchmark(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const r = await trx.deleteFrom('crop_benchmarks').where('id', '=', id).executeTakeFirst();
      if (!Number(r.numDeletedRows)) throw notFound('Benchmark');
      await record(trx, ctx, { entityType: 'crop_benchmark', entityId: id, action: 'deleted', changes: {} });
    });
  }

  /**
   * Market quotes for the crops of a harvest year, quoted against the organization's country when
   * the feed covers it, else Germany (reference orgMarketOf), with the farm's own price.
   */
  @Get('market-prices')
  @Requires('finance.read')
  marketPrices(@OrgCtx() ctx: Ctx, @Query('harvestYear', ParseIntPipe) harvestYear: number): Promise<CropMarketPrices[]> {
    return this.db.run(ctx, async (trx) => {
      const org = await trx.selectFrom('organizations').select('country').where('id', '=', ctx.orgId).executeTakeFirst();
      const country = (SUPPORTED_MARKET_COUNTRIES as readonly string[]).includes(org?.country ?? '') ? org!.country! : 'DE';
      const crops = await sql<{ id: string; code: string | null; name: string; own: number | null }>`
        SELECT DISTINCT c.id, c.code, coalesce(c.name_de, c.name) AS name, cp.price_per_t AS own
        FROM crop_cycles cc JOIN growing_seasons s ON s.id = cc.season_id AND s.harvest_year = ${harvestYear}
        JOIN crops c ON c.id = cc.crop_id
        LEFT JOIN crop_prices cp ON cp.crop_id = c.id AND cp.harvest_year = ${harvestYear}
        ORDER BY name`.execute(trx);
      const wanted = [...new Set(crops.rows.flatMap((c) => CROP_COMMODITIES[c.code ?? ''] ?? []))];
      const quotes = wanted.length
        ? await trx
            .selectFrom('market_quotes')
            .select(['commodity', 'country', 'quote_date', 'price'])
            .where('commodity', 'in', wanted)
            .where('country', '=', country)
            .where('quote_date', '>=', sql<string>`current_date - 400`)
            .orderBy('quote_date', 'desc')
            .execute()
        : [];
      const toQuote = (q: (typeof quotes)[number]): MarketQuote => ({ commodity: q.commodity as MarketCommodity, country: q.country, quoteDate: q.quote_date, price: q.price });
      return crops.rows.map((c) => {
        const commodities = CROP_COMMODITIES[c.code ?? ''] ?? [];
        const series = quotes.filter((q) => commodities.includes(q.commodity as MarketCommodity)).map(toQuote);
        const latest = commodities.flatMap((m) => series.find((q) => q.commodity === m) ?? []);
        return { cropId: c.id, cropName: c.name, commodities, latest, series, ownPricePerT: c.own };
      });
    });
  }
}

function benchmarkValues(i: Out<typeof CropBenchmarkInput>) {
  return {
    crop_id: i.cropId,
    name: i.name,
    yield_t_ha: i.yieldTHa ?? null,
    revenue_per_ha: i.revenuePerHa ?? null,
    direct_costs_per_ha: i.directCostsPerHa ?? null,
    variable_costs_per_ha: i.variableCostsPerHa ?? null,
    db1_per_ha: i.db1PerHa ?? null,
    db2_per_ha: i.db2PerHa ?? null,
    source: i.source ?? null,
  };
}

async function queryBenchmarks(trx: Trx, id?: string): Promise<CropBenchmark[]> {
  let q = trx
    .selectFrom('crop_benchmarks as b')
    .innerJoin('crops as c', 'c.id', 'b.crop_id')
    .selectAll('b')
    .select(sql<string>`coalesce(c.name_de, c.name)`.as('crop_name'))
    .orderBy('crop_name')
    .orderBy('b.name');
  if (id) q = q.where('b.id', '=', id);
  return (await q.execute()).map((b) => ({
    id: b.id,
    cropId: b.crop_id,
    cropName: b.crop_name,
    name: b.name,
    yieldTHa: b.yield_t_ha,
    revenuePerHa: b.revenue_per_ha,
    directCostsPerHa: b.direct_costs_per_ha,
    variableCostsPerHa: b.variable_costs_per_ha,
    db1PerHa: b.db1_per_ha,
    db2PerHa: b.db2_per_ha,
    source: b.source,
  }));
}

function duplicate(e: unknown): never {
  if ((e as { code?: string }).code === '23505') throw badRequest('benchmark_exists', 'A benchmark with this name already exists for the crop');
  if ((e as { code?: string }).code === '23503') throw badRequest('unknown_crop', 'Unknown crop');
  throw e;
}
