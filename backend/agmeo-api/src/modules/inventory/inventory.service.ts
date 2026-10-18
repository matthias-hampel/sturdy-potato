import { Injectable } from '@nestjs/common';
import type {
  BaseUnit,
  FertilizerCatalogueEntry,
  FertilizerType,
  FromCatalogueInput,
  FromPsmInput,
  PsmProductSummary,
  PsmUse,
  Product,
  ProductCategory,
  ProductInput,
  StockBalance,
  StockMovement,
  StockMovementInput,
  StockMovementKind,
  StorageLocation,
  StorageLocationInput,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

/** A product is usable while approved, or after its approval ended until the use-up period lapses. */
export const psmUsable = (approvalEndsOn: string | null, useUpUntil: string | null, on = today()) =>
  (approvalEndsOn == null || approvalEndsOn >= on) || (useUpUntil != null && useUpUntil >= on);

/** BVL dose unit codes (Kodeliste 25) that map to a base unit of ours, per hectare. */
const PSM_UNIT: Record<string, { baseUnit: 'l' | 'kg'; factor: number; label: string }> = {
  LH: { baseUnit: 'l', factor: 1, label: 'l/ha' },
  CH: { baseUnit: 'l', factor: 0.001, label: 'ml/ha' },
  KH: { baseUnit: 'kg', factor: 1, label: 'kg/ha' },
  GH: { baseUnit: 'kg', factor: 0.001, label: 'g/ha' },
};
export const psmUnit = (code: string | null) => (code ? PSM_UNIT[code.trim().toUpperCase()] ?? null : null);

@Injectable()
export class InventoryService {
  constructor(private readonly db: Database) {}

  products(ctx: Ctx, opts: { includeArchived?: boolean; category?: string } = {}): Promise<Product[]> {
    return this.db.run(ctx, (trx) => this.queryProducts(trx, opts));
  }

  async queryProducts(trx: Trx, opts: { ids?: string[]; includeArchived?: boolean; category?: string }): Promise<Product[]> {
    let q = trx
      .selectFrom('products as p')
      .leftJoin('psm_products as psm', 'psm.kennr', 'p.registration_number')
      .selectAll('p')
      .select(['psm.kennr as psm_kennr', 'psm.approval_ends_on as psm_approval_ends_on', 'psm.use_up_until as psm_use_up_until'])
      .select((eb) =>
        eb
          .selectFrom('stock_movements as m')
          .select(sql<number>`coalesce(sum(m.quantity_delta), 0)`.as('q'))
          .whereRef('m.product_id', '=', 'p.id')
          .as('stock'),
      )
      .orderBy('p.category')
      .orderBy('p.name');
    if (opts.ids) q = q.where('p.id', 'in', opts.ids.length ? opts.ids : ['00000000-0000-0000-0000-000000000000']);
    if (!opts.includeArchived) q = q.where('p.archived_at', 'is', null);
    if (opts.category) q = q.where('p.category', '=', opts.category);
    const rows = await q.execute();
    return rows.map((r) => {
      const stock = Number(r.stock ?? 0);
      return {
        id: r.id,
        category: r.category as ProductCategory,
        name: r.name,
        manufacturer: r.manufacturer,
        baseUnit: r.base_unit as BaseUnit,
        unitCost: r.unit_cost,
        registrationNumber: r.registration_number,
        activeIngredients: r.active_ingredients,
        nPct: r.n_pct,
        p2o5Pct: r.p2o5_pct,
        k2oPct: r.k2o_pct,
        sPct: r.s_pct,
        nh4NPct: r.nh4_n_pct,
        mgoPct: r.mgo_pct,
        caoPct: r.cao_pct,
        dryMatterPct: r.dry_matter_pct,
        densityTM3: r.density_t_m3,
        fertilizerType: r.fertilizer_type as FertilizerType | null,
        catalogueEntryId: r.catalogue_entry_id,
        psm: r.psm_kennr
          ? { kennr: r.psm_kennr, approvalEndsOn: r.psm_approval_ends_on, useUpUntil: r.psm_use_up_until, usable: psmUsable(r.psm_approval_ends_on, r.psm_use_up_until) }
          : null,
        lowStockThreshold: r.low_stock_threshold,
        notes: r.notes,
        archivedAt: iso(r.archived_at),
        stock,
        lowStock: r.low_stock_threshold != null && stock <= r.low_stock_threshold,
      };
    });
  }

  private productValues(input: Out<typeof ProductInput>) {
    return {
      category: input.category,
      name: input.name,
      manufacturer: input.manufacturer ?? null,
      base_unit: input.baseUnit,
      unit_cost: input.unitCost ?? null,
      registration_number: input.registrationNumber ?? null,
      active_ingredients: input.activeIngredients ?? null,
      n_pct: input.nPct ?? null,
      p2o5_pct: input.p2o5Pct ?? null,
      k2o_pct: input.k2oPct ?? null,
      s_pct: input.sPct ?? null,
      nh4_n_pct: input.nh4NPct ?? null,
      mgo_pct: input.mgoPct ?? null,
      cao_pct: input.caoPct ?? null,
      dry_matter_pct: input.dryMatterPct ?? null,
      density_t_m3: input.densityTM3 ?? null,
      fertilizer_type: input.fertilizerType ?? null,
      low_stock_threshold: input.lowStockThreshold ?? null,
      notes: input.notes ?? null,
    };
  }

  createProduct(ctx: Ctx, input: Out<typeof ProductInput>): Promise<Product> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('products')
        .values({ organization_id: ctx.orgId, ...this.productValues(input) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'product', entityId: id, action: 'created', changes: { name: input.name } });
      return (await this.queryProducts(trx, { ids: [id], includeArchived: true }))[0];
    });
  }

  updateProduct(ctx: Ctx, id: string, input: Out<typeof ProductInput>): Promise<Product> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Product');
      // Changing the base unit would silently reinterpret every recorded quantity.
      const values = { ...this.productValues(input), base_unit: before.base_unit };
      const archived_at = input.archived === undefined ? before.archived_at : input.archived ? (before.archived_at ?? new Date()) : null;
      await trx.updateTable('products').set({ ...values, archived_at }).where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'product', entityId: id, action: 'updated', changes: diff(before, values) });
      return (await this.queryProducts(trx, { ids: [id], includeArchived: true }))[0];
    });
  }

  storageLocations(ctx: Ctx): Promise<StorageLocation[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx.selectFrom('storage_locations').select(['id', 'name', 'farm_id']).orderBy('name').execute();
      return rows.map((r) => ({ id: r.id, name: r.name, farmId: r.farm_id }));
    });
  }

  createStorageLocation(ctx: Ctx, input: Out<typeof StorageLocationInput>): Promise<StorageLocation> {
    return this.db.run(ctx, async (trx) => {
      const r = await trx
        .insertInto('storage_locations')
        .values({ organization_id: ctx.orgId, name: input.name, farm_id: input.farmId ?? null })
        .returning(['id', 'name', 'farm_id'])
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'storage_location', entityId: r.id, action: 'created', changes: { name: input.name } });
      return { id: r.id, name: r.name, farmId: r.farm_id };
    });
  }

  balances(ctx: Ctx, productId?: string): Promise<StockBalance[]> {
    return this.db.run(ctx, async (trx) => {
      let q = trx
        .selectFrom('stock_balances as b')
        .leftJoin('storage_locations as s', 's.id', 'b.storage_location_id')
        .select(['b.product_id', 'b.storage_location_id', 's.name', 'b.quantity'])
        .orderBy('s.name');
      if (productId) q = q.where('b.product_id', '=', productId);
      const rows = await q.execute();
      return rows.map((r) => ({
        productId: r.product_id!,
        storageLocationId: r.storage_location_id,
        storageLocationName: r.name,
        quantity: Number(r.quantity ?? 0),
      }));
    });
  }

  movements(ctx: Ctx, opts: { productId?: string; operationId?: string; limit?: number }): Promise<StockMovement[]> {
    return this.db.run(ctx, async (trx) => {
      let q = trx
        .selectFrom('stock_movements as m')
        .innerJoin('products as p', 'p.id', 'm.product_id')
        .leftJoin('storage_locations as s', 's.id', 'm.storage_location_id')
        .leftJoin('operations as o', 'o.id', 'm.operation_id')
        .leftJoin('users as u', 'u.id', 'm.created_by')
        .select([
          'm.id',
          'm.product_id',
          'p.name as product_name',
          'p.base_unit',
          'm.storage_location_id',
          's.name as storage_name',
          'm.kind',
          'm.quantity_delta',
          'm.unit_cost',
          'm.occurred_at',
          'm.operation_id',
          'o.title as operation_title',
          'm.note',
          'u.display_name',
        ])
        .orderBy('m.occurred_at', 'desc')
        .orderBy('m.created_at', 'desc')
        .limit(Math.min(opts.limit ?? 200, 1000));
      if (opts.productId) q = q.where('m.product_id', '=', opts.productId);
      if (opts.operationId) q = q.where('m.operation_id', '=', opts.operationId);
      const rows = await q.execute();
      return rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        baseUnit: r.base_unit as BaseUnit,
        storageLocationId: r.storage_location_id,
        storageLocationName: r.storage_name,
        kind: r.kind as StockMovementKind,
        quantityDelta: r.quantity_delta,
        unitCost: r.unit_cost,
        occurredAt: iso(r.occurred_at),
        operationId: r.operation_id,
        operationTitle: r.operation_title,
        note: r.note,
        createdByName: r.display_name,
      }));
    });
  }

  /** Manual receipts and stocktake adjustments. Consumption only comes from operations. */
  createMovement(ctx: Ctx, input: Out<typeof StockMovementInput>): Promise<Product> {
    return this.db.run(ctx, async (trx) => {
      const product = await trx.selectFrom('products').select(['id', 'unit_cost']).where('id', '=', input.productId).executeTakeFirst();
      if (!product) throw notFound('Product');
      const { id } = await trx
        .insertInto('stock_movements')
        .values({
          organization_id: ctx.orgId,
          product_id: input.productId,
          storage_location_id: input.storageLocationId ?? null,
          kind: input.kind,
          quantity_delta: input.quantityDelta,
          unit_cost: input.unitCost ?? null,
          occurred_at: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          note: input.note ?? null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // A receipt with a price updates the default valuation for future applications.
      if (input.kind === 'receipt' && input.unitCost != null) {
        await trx.updateTable('products').set({ unit_cost: input.unitCost }).where('id', '=', input.productId).execute();
      }
      await record(trx, ctx, {
        entityType: 'product',
        entityId: input.productId,
        action: input.kind === 'receipt' ? 'stock_received' : 'stock_adjusted',
        changes: { movementId: id, quantityDelta: input.quantityDelta },
        event: { type: 'inventory.movement_recorded', payload: { productId: input.productId, movementId: id, kind: input.kind } },
      });
      return (await this.queryProducts(trx, { ids: [input.productId], includeArchived: true }))[0];
    });
  }

  // ---------------------------------------------------------------------------
  // Catalogues: fertilizer standard values and the BVL plant-protection register
  // ---------------------------------------------------------------------------

  fertilizerCatalogue(ctx: Ctx, q: { search?: string; type?: string }): Promise<FertilizerCatalogueEntry[]> {
    return this.db.run(ctx, async (trx) => {
      let query = trx.selectFrom('fertilizer_catalogue').selectAll().orderBy('name_de').limit(200);
      for (const word of (q.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)) {
        query = query.where(sql<boolean>`lower(name_de || ' ' || name_en) LIKE ${'%' + word.replace(/[%_]/g, '') + '%'}`);
      }
      if (q.type) query = query.where('fertilizer_type', '=', q.type);
      return (await query.execute()).map((r) => ({
        id: r.id,
        name: r.name_de,
        fertilizerType: r.fertilizer_type as FertilizerType,
        state: r.state as 'solid' | 'liquid',
        suggestedUnit: r.suggested_unit as BaseUnit,
        nPct: r.n_pct,
        nh4NPct: r.nh4_n_pct,
        p2o5Pct: r.p2o5_pct,
        k2oPct: r.k2o_pct,
        mgoPct: r.mgo_pct,
        caoPct: r.cao_pct,
        dryMatterPct: r.dry_matter_pct,
        densityTM3: r.density_t_m3,
        indicativePrice: r.indicative_price,
      }));
    });
  }

  /** Copies a catalogue entry into the organization's products; the copy can then be corrected with an own analysis. */
  createFromCatalogue(ctx: Ctx, input: Out<typeof FromCatalogueInput>): Promise<Product> {
    return this.db.run(ctx, async (trx) => {
      const e = await trx.selectFrom('fertilizer_catalogue').selectAll().where('id', '=', input.catalogueEntryId).executeTakeFirst();
      if (!e) throw notFound('Catalogue entry');
      const { id } = await trx
        .insertInto('products')
        .values({
          organization_id: ctx.orgId,
          category: 'fertilizer',
          name: input.name ?? e.name_de,
          base_unit: e.suggested_unit,
          unit_cost: input.unitCost ?? e.indicative_price,
          n_pct: e.n_pct,
          nh4_n_pct: e.nh4_n_pct,
          p2o5_pct: e.p2o5_pct,
          k2o_pct: e.k2o_pct,
          mgo_pct: e.mgo_pct,
          cao_pct: e.cao_pct,
          dry_matter_pct: e.dry_matter_pct,
          density_t_m3: e.density_t_m3,
          fertilizer_type: e.fertilizer_type,
          catalogue_entry_id: e.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'product', entityId: id, action: 'created', changes: { name: input.name ?? e.name_de, catalogueEntryId: e.id } });
      return (await this.queryProducts(trx, { ids: [id], includeArchived: true }))[0];
    });
  }

  psmProducts(ctx: Ctx, search: string): Promise<PsmProductSummary[]> {
    return this.db.run(ctx, async (trx) => {
      const term = search.trim().toLowerCase().replace(/[%_]/g, '');
      if (term.length < 2) return [];
      const rows = await trx
        .selectFrom('psm_products')
        .selectAll()
        .where((eb) => eb.or([eb(sql`lower(name)`, 'like', `${term}%`), eb(sql`lower(name)`, 'like', `% ${term}%`), eb('kennr', 'like', `${term}%`)]))
        .orderBy(sql`approval_ends_on >= current_date`, sql`desc nulls first`)
        .orderBy('name')
        .limit(50)
        .execute();
      return rows.map((r) => ({
        kennr: r.kennr,
        name: r.name,
        formulation: r.formulation,
        approvalEndsOn: r.approval_ends_on,
        useUpUntil: r.use_up_until,
        usable: psmUsable(r.approval_ends_on, r.use_up_until),
        activeIngredients: r.active_ingredients as PsmProductSummary['activeIngredients'],
      }));
    });
  }

  /** Approved professional uses of a product; with a crop, those approved for it come first. */
  psmUses(ctx: Ctx, kennr: string, cropId?: string): Promise<PsmUse[]> {
    return this.db.run(ctx, async (trx) => {
      const crop = cropId ? await trx.selectFrom('crops').select('eppo_code').where('id', '=', cropId).executeTakeFirst() : undefined;
      const ancestors = crop?.eppo_code
        ? ((await sql<{ a: string[] }>`SELECT app.psm_crop_ancestors(${crop.eppo_code}) AS a`.execute(trx)).rows[0]?.a ?? [])
        : [];
      const uses = await trx.selectFrom('psm_uses').selectAll().where('kennr', '=', kennr).where('professional', '=', true).orderBy('awg_id').execute();
      const codes = [...new Set(uses.flatMap((u) => [...u.crop_codes, ...u.target_codes, u.dose_unit].filter((c): c is string => !!c)))];
      const texts = new Map(
        codes.length ? (await trx.selectFrom('psm_codes').select(['code', 'text']).where('code', 'in', codes).execute()).map((c) => [c.code, c.text]) : [],
      );
      const out = uses.map((u) => {
        const matches = ancestors.length > 0 && u.crop_codes.some((c) => ancestors.includes(c)) && !u.excluded_crop_codes.some((c) => ancestors.includes(c));
        const waiting = u.waiting_days as Record<string, number | null>;
        const waitKey = ancestors.find((a) => a in waiting);
        return {
          awgId: u.awg_id,
          matchesCrop: matches,
          cropNames: u.crop_codes.map((c) => texts.get(c) ?? c),
          targets: u.target_codes.map((c) => texts.get(c) ?? c),
          bbchFrom: u.bbch_from,
          bbchTo: u.bbch_to,
          maxApplications: u.max_applications,
          minIntervalDays: u.min_interval_days,
          doseMax: u.dose_max,
          doseUnit: psmUnit(u.dose_unit)?.label ?? (u.dose_unit ? (texts.get(u.dose_unit) ?? u.dose_unit) : null),
          waterMinLHa: u.water_min_l_ha,
          waterMaxLHa: u.water_max_l_ha,
          waitingDays: waitKey ? (waiting[waitKey] ?? null) : null,
        };
      });
      return out.sort((a, b) => Number(b.matchesCrop) - Number(a.matchesCrop));
    });
  }

  /** Adds a product from the BVL register: its registration number links it to the approvals. */
  createFromPsm(ctx: Ctx, input: Out<typeof FromPsmInput>): Promise<Product> {
    return this.db.run(ctx, async (trx) => {
      const p = await trx.selectFrom('psm_products').selectAll().where('kennr', '=', input.kennr).executeTakeFirst();
      if (!p) throw notFound('Plant-protection product');
      const existing = await trx.selectFrom('products').select('id').where('registration_number', '=', p.kennr).where('archived_at', 'is', null).executeTakeFirst();
      if (existing) throw badRequest('product_exists', `${p.name} is already in your products`);
      const units = await trx.selectFrom('psm_uses').select('dose_unit').where('kennr', '=', p.kennr).where('dose_unit', 'is not', null).execute();
      const baseUnit = units.map((u) => psmUnit(u.dose_unit)?.baseUnit).find(Boolean) ?? (p.formulation && /^(WG|WP|GR|SG|WS|DP)$/.test(p.formulation) ? 'kg' : 'l');
      const ingredients = (p.active_ingredients as PsmProductSummary['activeIngredients']).map((a) => `${a.name}${a.content != null ? ` ${a.content} ${a.unit ?? ''}`.trimEnd() : ''}`).join(', ');
      const { id } = await trx
        .insertInto('products')
        .values({
          organization_id: ctx.orgId,
          category: 'crop_protection',
          name: p.name,
          base_unit: baseUnit,
          unit_cost: input.unitCost ?? null,
          registration_number: p.kennr,
          active_ingredients: ingredients || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'product', entityId: id, action: 'created', changes: { name: p.name, kennr: p.kennr } });
      return (await this.queryProducts(trx, { ids: [id], includeArchived: true }))[0];
    });
  }
}

