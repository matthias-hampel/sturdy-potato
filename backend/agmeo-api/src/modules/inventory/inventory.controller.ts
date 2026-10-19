import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import {
  type CalculationParameters,
  FromCatalogueInput,
  FromPsmInput,
  ProductInput,
  ProductPriceInput,
  StockMovementInput,
  StocktakeInput,
  StorageLocationInput,
  VoidMovementInput,
} from '@agmeo/contracts';
import type { Response } from 'express';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { CO2E_FACTOR_SET, calculationParameters } from '../carbon/co2e.js';
import { InventoryService } from './inventory.service.js';

@Controller('orgs/:orgId')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('products')
  products(@OrgCtx() ctx: Ctx, @Query('includeArchived') includeArchived?: string, @Query('category') category?: string) {
    return this.inventory.products(ctx, { includeArchived: includeArchived === 'true', category });
  }

  @Post('products')
  @Requires('inventory.write')
  createProduct(@OrgCtx() ctx: Ctx, @ZBody(ProductInput) input: Out<typeof ProductInput>) {
    return this.inventory.createProduct(ctx, input);
  }

  @Post('products/from-catalogue')
  @Requires('inventory.write')
  createFromCatalogue(@OrgCtx() ctx: Ctx, @ZBody(FromCatalogueInput) input: Out<typeof FromCatalogueInput>) {
    return this.inventory.createFromCatalogue(ctx, input);
  }

  @Post('products/from-psm')
  @Requires('inventory.write')
  createFromPsm(@OrgCtx() ctx: Ctx, @ZBody(FromPsmInput) input: Out<typeof FromPsmInput>) {
    return this.inventory.createFromPsm(ctx, input);
  }

  @Get('catalogue/fertilizers')
  fertilizerCatalogue(@OrgCtx() ctx: Ctx, @Query('q') search?: string, @Query('type') type?: string) {
    return this.inventory.fertilizerCatalogue(ctx, { search, type });
  }

  @Get('catalogue/psm')
  psmProducts(@OrgCtx() ctx: Ctx, @Query('q') search = '') {
    return this.inventory.psmProducts(ctx, search);
  }

  @Get('catalogue/psm/:kennr/uses')
  psmUses(@OrgCtx() ctx: Ctx, @Param('kennr') kennr: string, @Query('cropId') cropId?: string) {
    return this.inventory.psmUses(ctx, kennr, cropId);
  }

  @Put('products/:id')
  @Requires('inventory.write')
  updateProduct(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(ProductInput) input: Out<typeof ProductInput>) {
    return this.inventory.updateProduct(ctx, id, input);
  }

  @Get('storage-locations')
  storageLocations(@OrgCtx() ctx: Ctx) {
    return this.inventory.storageLocations(ctx);
  }

  @Post('storage-locations')
  @Requires('inventory.write')
  createStorageLocation(@OrgCtx() ctx: Ctx, @ZBody(StorageLocationInput) input: Out<typeof StorageLocationInput>) {
    return this.inventory.createStorageLocation(ctx, input);
  }

  @Get('stock/balances')
  balances(@OrgCtx() ctx: Ctx, @Query('productId') productId?: string) {
    return this.inventory.balances(ctx, productId);
  }

  @Get('stock/movements')
  movements(@OrgCtx() ctx: Ctx, @Query('productId') productId?: string, @Query('operationId') operationId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.inventory.movements(ctx, { productId, operationId, from: isoDay(from), to: isoDay(to) });
  }

  @Get('stock/balances.csv')
  async balancesCsv(@OrgCtx() ctx: Ctx, @Res() res: Response) {
    sendCsv(res, await this.inventory.balancesCsv(ctx));
  }

  @Get('stock/movements.csv')
  async movementsCsv(@OrgCtx() ctx: Ctx, @Res() res: Response, @Query('productId') productId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    sendCsv(res, await this.inventory.movementsCsv(ctx, { productId, from: isoDay(from), to: isoDay(to) }));
  }

  @Post('stock/movements/:id/void')
  @Requires('inventory.write')
  voidMovement(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(VoidMovementInput) input: Out<typeof VoidMovementInput>) {
    return this.inventory.voidMovement(ctx, id, input.reason);
  }

  @Post('stock/stocktake')
  @Requires('inventory.write')
  stocktake(@OrgCtx() ctx: Ctx, @ZBody(StocktakeInput) input: Out<typeof StocktakeInput>) {
    return this.inventory.stocktake(ctx, input);
  }

  @Get('prices')
  prices(@OrgCtx() ctx: Ctx, @Query('year', ParseIntPipe) year: number) {
    if (year < 1990 || year > 2200) throw badRequest('invalid_year', 'Year out of range');
    return this.inventory.prices(ctx, year);
  }

  @Get('calculation-parameters')
  calculationParameters(@OrgCtx() _ctx: Ctx): CalculationParameters {
    return { factorSet: CO2E_FACTOR_SET, parameters: calculationParameters() };
  }

  @Put('prices')
  @Requires('inventory.write')
  setPrices(@OrgCtx() ctx: Ctx, @ZBody(ProductPriceInput) input: Out<typeof ProductPriceInput>) {
    return this.inventory.setPrices(ctx, input);
  }

  @Post('stock/movements')
  @Requires('inventory.write')
  createMovement(@OrgCtx() ctx: Ctx, @ZBody(StockMovementInput) input: Out<typeof StockMovementInput>) {
    return this.inventory.createMovement(ctx, input);
  }
}

const isoDay = (v?: string) => {
  if (v == null || v === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
  return v;
};

function sendCsv(res: Response, { filename, csv }: { filename: string; csv: string }) {
  res
    .status(200)
    .set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` })
    .send('\ufeff' + csv);
}
