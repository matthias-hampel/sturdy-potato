import { Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { FromCatalogueInput, FromPsmInput, ProductInput, StockMovementInput, StorageLocationInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
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
  movements(@OrgCtx() ctx: Ctx, @Query('productId') productId?: string, @Query('operationId') operationId?: string) {
    return this.inventory.movements(ctx, { productId, operationId });
  }

  @Post('stock/movements')
  @Requires('inventory.write')
  createMovement(@OrgCtx() ctx: Ctx, @ZBody(StockMovementInput) input: Out<typeof StockMovementInput>) {
    return this.inventory.createMovement(ctx, input);
  }
}
