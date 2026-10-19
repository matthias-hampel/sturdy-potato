/**
 * Development seed: a demo arable farm near Sehnde (Region Hannover) with two seasons of
 * crops, operations, inventory, machinery and harvests. Runs through the domain services,
 * so audit events, the stock ledger, costs and outbox events are produced exactly as in
 * normal use. All people, products and figures are fictitious demo data.
 *
 *   pnpm --filter @agmeo/api build && pnpm db:seed
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FieldGeometry, OperationInput } from '@agmeo/contracts';
import type { Out } from './core/validation.js';
import { sql } from 'kysely';
import { AppModule } from './app.module.js';
import type { Ctx } from './auth/context.js';
import { Database } from './db/database.js';
import { CropsService } from './modules/crops/crops.service.js';
import { EconomicsService } from './modules/economics/economics.service.js';
import { FarmsService } from './modules/farms/farms.service.js';
import { FieldsService } from './modules/fields/fields.service.js';
import { IdentityService } from './modules/identity/identity.service.js';
import { InventoryService } from './modules/inventory/inventory.service.js';
import { EconomicsService as Economics } from './modules/economics/economics.service.js';
import { NutrientsService } from './modules/nutrients/nutrients.service.js';
import { OperationsService } from './modules/operations/operations.service.js';
import { PlanningService } from './modules/planning/planning.service.js';
import { RegulatoryService } from './modules/regulatory/regulatory.service.js';
import { TasksService } from './modules/tasks/tasks.service.js';
import { TeamService } from './modules/team/team.service.js';

const OWNER = { email: 'anna@example.com', name: 'Anna Bauer' };
const ORG_NAME = 'Hof Sonnenfeld GbR';

const poly = (ring: [number, number][]): FieldGeometry => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

// Traced from aerial imagery south of the Mittellandkanal near Sehnde.
const FIELDS: { name: string; identifier: string; soil: string; tenure: 'owned' | 'leased'; ring: [number, number][] }[] = [
  { name: 'Große Breite', identifier: 'DENILI0312345601', soil: 'Löss (Lö), Parabraunerde', tenure: 'owned', ring: [[9.980859, 52.306094], [9.9841, 52.306195], [9.9841, 52.30428], [9.980859, 52.30428]] },
  { name: 'Am Kirchweg', identifier: 'DENILI0312345602', soil: 'Löss (Lö), Parabraunerde', tenure: 'owned', ring: [[9.980859, 52.304146], [9.9841, 52.304146], [9.9841, 52.301929], [9.980859, 52.301929]] },
  { name: 'Mühlenfeld', identifier: 'DENILI0312345603', soil: 'Sandiger Lehm (sL)', tenure: 'leased', ring: [[9.98432, 52.306363], [9.986462, 52.306531], [9.986462, 52.304448], [9.98432, 52.304448]] },
  { name: 'Rübenacker', identifier: 'DENILI0312345604', soil: 'Löss (Lö), Schwarzerde', tenure: 'owned', ring: [[9.98432, 52.304314], [9.986462, 52.304314], [9.986462, 52.301929], [9.98432, 52.301929]] },
  { name: 'Kanalstück', identifier: 'DENILI0312345605', soil: 'Lehmiger Sand (lS)', tenure: 'leased', ring: [[9.977454, 52.305859], [9.980585, 52.306027], [9.980585, 52.303037]] },
  { name: 'Lange Wiese', identifier: 'DENILI0312345606', soil: 'Toniger Auenlehm', tenure: 'owned', ring: [[9.98075, 52.308411], [9.983606, 52.308411], [9.983606, 52.307202], [9.98075, 52.307135]] },
  { name: 'Hinterm Hof', identifier: 'DENILI0312345607', soil: 'Löss (Lö)', tenure: 'owned', ring: [[9.983936, 52.308411], [9.986462, 52.308411], [9.986462, 52.307337], [9.983936, 52.307202]] },
];

async function main() {
  const log = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const db = app.get(Database);
  const identity = app.get(IdentityService);

  const signIn = async (email: string, name: string) =>
    (await sql<{ id: string }>`SELECT app.sign_in(${`dev|${email}`}, ${email}, ${name}) AS id`.execute(db.kysely)).rows[0].id;

  const ownerId = await signIn(OWNER.email, OWNER.name);
  const existing = (await identity.me(ownerId)).organizations.find((o) => o.name === ORG_NAME);
  if (existing) {
    const ctx: Ctx = { userId: ownerId, orgId: existing.id, role: 'owner' }
    const added = await seedMarschhof(app, ctx)
    const planned = await seedPlanningAndCompliance(app, ctx)
    log.log(`"${ORG_NAME}" already exists (${existing.id}); ${[added && 'added farm Marschhof', planned && 'added planning, soil and compliance data'].filter(Boolean).join(', ') || 'nothing to do'}. Reset with: docker compose down -v`)
    await app.close()
    return;
  }

  const org = await identity.createOrganization(ownerId, { name: ORG_NAME, country: 'DE', currency: 'EUR' });
  const ctx: Ctx = { userId: ownerId, orgId: org.id, role: 'owner' };
  log.log(`Created organization ${org.name} (${org.id})`);

  // People ------------------------------------------------------------------
  await identity.inviteMember(ctx, { email: 'jonas@example.com', displayName: 'Jonas Meyer', role: 'manager' });
  await identity.inviteMember(ctx, { email: 'lena@example.com', displayName: 'Lena Schulz', role: 'worker' });
  await identity.inviteMember(ctx, { email: 'paul@example.com', displayName: 'Paul Krüger', role: 'accountant' });
  await identity.inviteMember(ctx, { email: 'mira@example.com', displayName: 'Dr. Mira Hoffmann', role: 'agronomist' });

  const team = app.get(TeamService);
  const anna = await team.createEmployee(ctx, { name: 'Anna Bauer', userId: ownerId, role: 'manager', staffNumber: '001', jobTitle: 'Inhaberin', hourlyRate: 32, active: true });
  const jonas = await team.createEmployee(ctx, { name: 'Jonas Meyer', role: 'manager', staffNumber: '002', jobTitle: 'Betriebsleiter', email: 'jonas@example.com', hourlyRate: 28, active: true });
  const lena = await team.createEmployee(ctx, { name: 'Lena Schulz', role: 'machine_operator', staffNumber: '003', jobTitle: 'Schlepperfahrerin', email: 'lena@example.com', hourlyRate: 21, active: true });
  await team.createEmployee(ctx, { name: 'Piotr Nowak', role: 'field_worker', jobTitle: 'Saisonarbeitskraft (Ernte)', hourlyRate: 17.5, active: false });

  // Farm and fields ---------------------------------------------------------
  const farm = await app.get(FarmsService).create(ctx, {
    name: 'Hof Sonnenfeld',
    address: 'Am Kanal 3, 31319 Sehnde',
    country: 'DE',
    timezone: 'Europe/Berlin',
    location: { lat: 52.3072, lng: 9.9822 },
    mapZoom: 14,
    notes: 'Demo-Betrieb',
  });
  const fieldsService = app.get(FieldsService);
  const fields: Record<string, string> = {};
  for (const f of FIELDS) {
    const field = await fieldsService.create(ctx, {
      farmId: farm.id,
      name: f.name,
      identifier: f.identifier,
      soilType: f.soil,
      tenure: f.tenure,
      geometry: poly(f.ring),
    });
    fields[f.name] = field.id;
  }

  // Machinery -----------------------------------------------------------------
  const tractor = await team.createEquipment(ctx, { name: 'Fendt 724 Vario', farmId: farm.id, class: 'machine', category: 'tractor_large', powerKw: 174, manufacturer: 'Fendt', model: '724 Vario Gen6', modelYear: 2021, registration: 'H-SF 724', hourMeter: 3410, hourlyCost: 68, status: 'active' });
  const sprayer = await team.createEquipment(ctx, { name: 'Amazone UX 5201', farmId: farm.id, class: 'implement', category: 'sprayer', mountType: 'trailed', workingWidthM: 36, manufacturer: 'Amazone', model: 'UX 5201 Super', modelYear: 2019, hourMeter: 1290, hourlyCost: 42, status: 'active' });
  const drill = await team.createEquipment(ctx, { name: 'Väderstad Rapid', farmId: farm.id, class: 'implement', category: 'combination_drill', mountType: 'trailed', workingWidthM: 6, manufacturer: 'Väderstad', model: 'Rapid A 600S', modelYear: 2017, hourMeter: 2100, hourlyCost: 38, status: 'active' });
  const spreader = await team.createEquipment(ctx, { name: 'Rauch Axis', farmId: farm.id, class: 'implement', category: 'fertilizer_spreader', mountType: 'three_point', workingWidthM: 36, manufacturer: 'Rauch', model: 'AXIS-H 50.2', modelYear: 2020, hourMeter: 640, hourlyCost: 18, status: 'active' });
  const combine = await team.createEquipment(ctx, { name: 'Claas Lexion 6800', farmId: farm.id, class: 'machine', category: 'combine', manufacturer: 'Claas', model: 'Lexion 6800', modelYear: 2018, hourMeter: 2875, hourlyCost: 165, status: 'active' });
  await team.createEquipment(ctx, { name: 'Lemken Karat', farmId: farm.id, class: 'implement', category: 'cultivator', mountType: 'three_point', workingWidthM: 3, manufacturer: 'Lemken', model: 'Karat 10', modelYear: 2015, hourMeter: 1810, hourlyCost: 24, status: 'active' });
  await team.addMaintenance(ctx, tractor.id, { performedOn: '2026-03-02', description: '3000-h-Inspektion: Motoröl, Filter, Hydrauliköl', cost: 1840, hourMeter: 3005, nextDueOn: '2027-03-01', nextDueHours: 3500 });
  await team.addMaintenance(ctx, combine.id, { performedOn: '2026-06-20', description: 'Inspektion vor der Ernte, neue Messerklingen', cost: 2350, hourMeter: 2790, nextDueOn: '2026-10-15', nextDueHours: 3000 });

  // Inventory ---------------------------------------------------------------
  const inventory = app.get(InventoryService);
  const shed = await inventory.createStorageLocation(ctx, { name: 'Maschinenhalle', farmId: farm.id });
  const store = await inventory.createStorageLocation(ctx, { name: 'Pflanzenschutzlager', farmId: farm.id });
  const product = async (p: Parameters<InventoryService['createProduct']>[1], receipts: [string, number, number][]) => {
    const created = await inventory.createProduct(ctx, p);
    for (const [date, qty, cost] of receipts) {
      await inventory.createMovement(ctx, {
        productId: created.id,
        storageLocationId: p.category === 'crop_protection' ? store.id : shed.id,
        kind: 'receipt',
        quantityDelta: qty,
        unitCost: cost,
        occurredAt: `${date}T08:00:00+02:00`,
        note: 'Lieferung',
      });
    }
    return created;
  };
  const wheatSeed = await product({ category: 'seed', name: 'Saatgut Winterweizen Z1', manufacturer: 'Demo Saatzucht', baseUnit: 'kg', unitCost: 0.78, lowStockThreshold: 200 }, [['2025-09-20', 2600, 0.74], ['2026-09-25', 1800, 0.78]]);
  const rapeSeed = await product({ category: 'seed', name: 'Saatgut Winterraps (Hybride)', manufacturer: 'Demo Saatzucht', baseUnit: 'unit', unitCost: 0.0004, notes: 'Einheit: Körner' }, [['2025-08-10', 3_000_000, 0.00039], ['2026-08-05', 2_500_000, 0.0004]]);
  const barleySeed = await product({ category: 'seed', name: 'Saatgut Wintergerste Z1', manufacturer: 'Demo Saatzucht', baseUnit: 'kg', unitCost: 0.72 }, [['2025-09-15', 1100, 0.7], ['2026-09-10', 1000, 0.73]]);
  const kas = await product({ category: 'fertilizer', name: 'Kalkammonsalpeter 27 N (KAS)', manufacturer: 'Demo Dünger', baseUnit: 'kg', unitCost: 0.36, nPct: 27, lowStockThreshold: 1000 }, [['2026-02-10', 12_000, 0.36]]);
  const ass = await product({ category: 'fertilizer', name: 'Ammonsulfatsalpeter 26 N + 13 S (ASS)', manufacturer: 'Demo Dünger', baseUnit: 'kg', unitCost: 0.41, nPct: 26, sPct: 13 }, [['2026-02-10', 4000, 0.41]]);
  const dap = await product({ category: 'fertilizer', name: 'Diammonphosphat 18-46', manufacturer: 'Demo Dünger', baseUnit: 'kg', nPct: 18, p2o5Pct: 46, unitCost: 0.68 }, [['2025-08-20', 2000, 0.68]]);
  const herbicide = await product({ category: 'crop_protection', name: 'Herbstherbizid A (Demo)', manufacturer: 'Demo Agro', baseUnit: 'l', unitCost: 24.5, activeIngredients: 'Demo-Wirkstoff', lowStockThreshold: 20 }, [['2025-10-01', 120, 24.5]]);
  const fungicide = await product({ category: 'crop_protection', name: 'Fungizid B (Demo)', manufacturer: 'Demo Agro', baseUnit: 'l', unitCost: 38, registrationNumber: 'DEMO-0001-00', activeIngredients: 'Demo-Azol' }, [['2026-04-01', 60, 38]]);
  await product({ category: 'fuel', name: 'Diesel', baseUnit: 'l', unitCost: 1.42, lowStockThreshold: 1500 }, [['2026-07-01', 6000, 1.42]]);

  // Seasons and crops ---------------------------------------------------------
  const crops = app.get(CropsService);
  await crops.createSeason(ctx, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' });
  const seasons = await crops.createSeason(ctx, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' });
  const s2026 = seasons.find((s) => s.harvestYear === 2026)!.id;
  const s2027 = seasons.find((s) => s.harvestYear === 2027)!.id;
  const catalogue = await crops.crops(ctx);
  const crop = (code: string) => catalogue.find((c) => c.code === code)!.id;
  const variety = async (code: string, name: string) => (await crops.createVariety(ctx, { cropId: crop(code), name })).id;
  const wheatVar = await variety('winter_wheat', 'Demo-Weizen A');
  const rapeVar = await variety('winter_rapeseed', 'Demo-Raps H1');

  const assign = async (season: string, code: string, names: string[], extra: Record<string, unknown> = {}) =>
    crops.createCropCycles(ctx, { seasonId: season, cropId: crop(code), fieldIds: names.map((n) => fields[n]), status: 'planned', ...extra });

  // Ernte 2026 (closed season with harvests)
  const c26wheat = await assign(s2026, 'winter_wheat', ['Am Kirchweg', 'Rübenacker'], { varietyId: wheatVar, expectedYieldTHa: 8.5, expectedPricePerT: 205 });
  const c26rape = await assign(s2026, 'winter_rapeseed', ['Große Breite'], { varietyId: rapeVar, expectedYieldTHa: 4.0, expectedPricePerT: 470 });
  const c26barley = await assign(s2026, 'winter_barley', ['Mühlenfeld', 'Kanalstück'], { expectedYieldTHa: 7.8, expectedPricePerT: 185 });
  await assign(s2026, 'grassland', ['Lange Wiese']);
  await assign(s2026, 'spring_barley', ['Hinterm Hof'], { expectedYieldTHa: 6.0, expectedPricePerT: 230 });

  // Ernte 2027 (current season): rotation rapeseed → wheat → barley
  await assign(s2027, 'winter_wheat', ['Große Breite'], { varietyId: wheatVar, expectedYieldTHa: 9.0, expectedPricePerT: 210 });
  await assign(s2027, 'winter_rapeseed', ['Mühlenfeld'], { varietyId: rapeVar, expectedYieldTHa: 4.2, expectedPricePerT: 480 });
  await assign(s2027, 'winter_barley', ['Am Kirchweg'], { expectedYieldTHa: 8.0, expectedPricePerT: 190 });
  await assign(s2027, 'sugar_beet', ['Rübenacker'], { expectedYieldTHa: 80, expectedPricePerT: 42 });
  await assign(s2027, 'grain_maize', ['Kanalstück', 'Hinterm Hof'], { expectedYieldTHa: 10.5, expectedPricePerT: 190 });
  await assign(s2027, 'grassland', ['Lange Wiese']);

  // Operations ----------------------------------------------------------------
  const ops = app.get(OperationsService);
  const done = async (input: Omit<OperationInput, 'details' | 'inputs' | 'labor' | 'equipment'> & Partial<OperationInput>, performedAt: string) => {
    const op = await ops.create(ctx, { details: {}, inputs: [], labor: [], equipment: [], plannedOn: performedAt.slice(0, 10), ...input } as Out<typeof OperationInput>);
    const completed = await ops.complete(ctx, op.id, { version: op.version, performedAt, allowNegativeStock: false });
    // Demo history is documented the day after the work, as it would have been.
    await db.run(ctx, (trx) =>
      trx.updateTable('operations').set({ completed_at: sql`performed_at + interval '20 hours'` }).where('id', '=', op.id).execute(),
    );
    return completed;
  };
  const on = (names: string[]) => names.map((n) => ({ fieldId: fields[n] }));

  await done({ farmId: farm.id, type: 'fertilization', title: 'P-Grunddüngung vor Raps', fields: on(['Große Breite']), inputs: [{ productId: dap.id, ratePerHa: 150 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 1.5 }], equipment: [{ equipmentId: tractor.id, hours: 1.5 }, { equipmentId: spreader.id, hours: 1.5 }], status: 'planned' }, '2025-08-21T09:00:00+02:00');
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Winterraps', fields: on(['Große Breite']), inputs: [{ productId: rapeSeed.id, ratePerHa: 450_000 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 3 }], equipment: [{ equipmentId: tractor.id, hours: 3 }, { equipmentId: drill.id, hours: 3 }], status: 'planned', details: { seedsPerM2: 45 } }, '2025-08-25T10:00:00+02:00');
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Wintergerste', fields: on(['Mühlenfeld', 'Kanalstück']), inputs: [{ productId: barleySeed.id, ratePerHa: 140 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 4.5 }], equipment: [{ equipmentId: tractor.id, hours: 4.5 }, { equipmentId: drill.id, hours: 4.5 }], status: 'planned' }, '2025-09-24T09:30:00+02:00');
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Winterweizen', fields: on(['Am Kirchweg', 'Rübenacker']), inputs: [{ productId: wheatSeed.id, ratePerHa: 165 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 5 }], equipment: [{ equipmentId: tractor.id, hours: 5 }, { equipmentId: drill.id, hours: 5 }], status: 'planned' }, '2025-10-14T08:30:00+02:00');
  await done({ farmId: farm.id, type: 'crop_protection', title: 'Herbstherbizid Getreide', fields: on(['Am Kirchweg', 'Rübenacker', 'Mühlenfeld', 'Kanalstück']), inputs: [{ productId: herbicide.id, ratePerHa: 1.0 }], responsibleEmployeeId: jonas.id, bbchStage: '11-12', targetOrganism: 'Ackerfuchsschwanz, zweikeimblättrige Unkräuter', weatherConditions: '9 °C, Wind 2 m/s, trocken', labor: [{ employeeId: jonas.id, hours: 3 }], equipment: [{ equipmentId: tractor.id, hours: 3 }, { equipmentId: sprayer.id, hours: 3 }], status: 'planned' }, '2025-10-30T10:00:00+01:00');
  await done({ farmId: farm.id, type: 'fertilization', title: '1. N-Gabe', fields: on(['Am Kirchweg', 'Rübenacker', 'Mühlenfeld', 'Kanalstück', 'Große Breite']), inputs: [{ productId: kas.id, ratePerHa: 220 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 4 }], equipment: [{ equipmentId: tractor.id, hours: 4 }, { equipmentId: spreader.id, hours: 4 }], status: 'planned' }, '2026-03-03T08:00:00+01:00');
  await done({ farmId: farm.id, type: 'fertilization', title: '2. N-Gabe mit Schwefel', fields: on(['Am Kirchweg', 'Rübenacker', 'Große Breite']), inputs: [{ productId: ass.id, ratePerHa: 200 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 3 }], equipment: [{ equipmentId: tractor.id, hours: 3 }, { equipmentId: spreader.id, hours: 3 }], status: 'planned' }, '2026-04-08T08:00:00+02:00');
  await done({ farmId: farm.id, type: 'crop_protection', title: 'Fungizid T2 Weizen', fields: on(['Am Kirchweg', 'Rübenacker']), inputs: [{ productId: fungicide.id, ratePerHa: 1.2 }], responsibleEmployeeId: jonas.id, bbchStage: '39', targetOrganism: 'Septoria tritici', weatherConditions: '16 °C, Wind 3 m/s', labor: [{ employeeId: jonas.id, hours: 2 }], equipment: [{ equipmentId: tractor.id, hours: 2 }, { equipmentId: sprayer.id, hours: 2 }], status: 'planned' }, '2026-05-12T07:00:00+02:00');
  await done({ farmId: farm.id, type: 'harvest', title: 'Ernte Wintergerste', fields: on(['Mühlenfeld', 'Kanalstück']), responsibleEmployeeId: jonas.id, labor: [{ employeeId: jonas.id, hours: 5 }], equipment: [{ equipmentId: combine.id, hours: 5 }], status: 'planned' }, '2026-07-04T13:00:00+02:00');
  await done({ farmId: farm.id, type: 'harvest', title: 'Ernte Winterraps', fields: on(['Große Breite']), responsibleEmployeeId: jonas.id, labor: [{ employeeId: jonas.id, hours: 3 }], equipment: [{ equipmentId: combine.id, hours: 3 }], status: 'planned' }, '2026-07-16T14:00:00+02:00');
  await done({ farmId: farm.id, type: 'harvest', title: 'Ernte Winterweizen', fields: on(['Am Kirchweg', 'Rübenacker']), responsibleEmployeeId: jonas.id, labor: [{ employeeId: jonas.id, hours: 6 }], contractorName: 'Lohnunternehmen Demo', contractorCost: 450, equipment: [{ equipmentId: combine.id, hours: 6 }], status: 'planned' }, '2026-07-28T12:00:00+02:00');

  // Ernte 2027 season so far
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Winterraps', fields: on(['Mühlenfeld']), inputs: [{ productId: rapeSeed.id, ratePerHa: 450_000 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 2 }], equipment: [{ equipmentId: tractor.id, hours: 2 }, { equipmentId: drill.id, hours: 2 }], status: 'planned' }, '2026-08-27T10:00:00+02:00');
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Wintergerste', fields: on(['Am Kirchweg']), inputs: [{ productId: barleySeed.id, ratePerHa: 150 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 2.5 }], equipment: [{ equipmentId: tractor.id, hours: 2.5 }, { equipmentId: drill.id, hours: 2.5 }], status: 'planned' }, '2026-09-23T09:00:00+02:00');
  await done({ farmId: farm.id, type: 'sowing', title: 'Aussaat Winterweizen', fields: on(['Große Breite']), inputs: [{ productId: wheatSeed.id, ratePerHa: 170 }], responsibleEmployeeId: lena.id, labor: [{ employeeId: lena.id, hours: 3 }], equipment: [{ equipmentId: tractor.id, hours: 3 }, { equipmentId: drill.id, hours: 3 }], status: 'planned' }, '2026-10-09T08:30:00+02:00');
  // An application recorded without crop growth stage and target, to show completeness checks.
  await done({ farmId: farm.id, type: 'crop_protection', title: 'Herbstherbizid Raps', fields: on(['Mühlenfeld']), inputs: [{ productId: herbicide.id, ratePerHa: 0.8 }], responsibleEmployeeId: jonas.id, labor: [{ employeeId: jonas.id, hours: 1 }], equipment: [{ equipmentId: tractor.id, hours: 1 }, { equipmentId: sprayer.id, hours: 1 }], status: 'planned' }, '2026-09-15T09:00:00+02:00');

  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await ops.create(ctx, { farmId: farm.id, type: 'crop_protection', title: 'Herbstherbizid Weizen', status: 'planned', plannedOn: inDays(5), fields: on(['Große Breite']), inputs: [{ productId: herbicide.id, ratePerHa: 1.0 }], responsibleEmployeeId: jonas.id, bbchStage: '11', targetOrganism: 'Ackerfuchsschwanz', labor: [], equipment: [{ equipmentId: sprayer.id, hours: 1.5 }], details: {} });
  await ops.create(ctx, { farmId: farm.id, type: 'tillage', title: 'Pflügen für Zuckerrüben', status: 'planned', plannedOn: inDays(12), fields: on(['Rübenacker']), inputs: [], responsibleEmployeeId: lena.id, labor: [], equipment: [], details: { depthCm: 25 } });
  await ops.create(ctx, { farmId: farm.id, type: 'tillage', title: 'Stoppelbearbeitung Maisflächen', status: 'planned', plannedOn: inDays(-6), fields: on(['Kanalstück', 'Hinterm Hof']), inputs: [], responsibleEmployeeId: lena.id, labor: [], equipment: [], details: {} });

  // Harvest records
  const econ = app.get(EconomicsService);
  const harvest = async (cycles: { id: string; fieldName: string }[], date: string, yields: Record<string, number>, price: number, basis: 'actual' | 'expected', moisture: number) => {
    for (const c of cycles) {
      const field = (await fieldsService.get(ctx, fields[c.fieldName])).areaHa;
      await econ.createHarvest(ctx, { cropCycleId: c.id, harvestDate: date, quantityT: Math.round(field * yields[c.fieldName] * 10) / 10, moisturePct: moisture, pricePerT: price, priceBasis: basis, quality: 'Standard' });
    }
  };
  await harvest(c26barley, '2026-07-04', { 'Mühlenfeld': 7.4, 'Kanalstück': 6.6 }, 178, 'actual', 13.8);
  await harvest(c26rape, '2026-07-16', { 'Große Breite': 3.9 }, 462, 'actual', 8.1);
  await harvest(c26wheat, '2026-07-28', { 'Am Kirchweg': 8.9, 'Rübenacker': 8.2 }, 212, 'expected', 14.2);
  await econ.createCostEntry(ctx, { seasonId: s2026, category: 'land', amount: 2400, basis: 'actual', description: 'Pacht Mühlenfeld + Kanalstück', incurredOn: '2025-11-11' });
  await econ.createCostEntry(ctx, { seasonId: s2026, category: 'insurance', amount: 1150, basis: 'actual', description: 'Hagelversicherung', incurredOn: '2026-04-01' });
  await db.run(ctx, (trx) => trx.updateTable('crop_cycles').set({ status: 'closed' }).where('season_id', '=', s2026).where('status', '=', 'harvested').execute());

  // Tasks ---------------------------------------------------------------------
  const tasks = app.get(TasksService);
  await tasks.create(ctx, { farmId: farm.id, fieldId: fields['Mühlenfeld'], title: 'Raps auf Schnecken und Rapserdflöhe kontrollieren', assigneeEmployeeId: jonas.id, dueOn: inDays(-2), priority: 'high', status: 'open' });
  await tasks.create(ctx, { farmId: farm.id, title: 'Mähdrescher einwintern', description: 'Vor dem Abstellen reinigen, abschmieren, Riemen prüfen', assigneeEmployeeId: lena.id, dueOn: inDays(3), priority: 'normal', status: 'open' });
  await tasks.create(ctx, { farmId: farm.id, fieldId: fields['Rübenacker'], title: 'Bodenprobe vor Zuckerrüben', assigneeEmployeeId: anna.id, dueOn: inDays(9), priority: 'normal', status: 'open' });
  await tasks.create(ctx, { farmId: farm.id, title: 'Zuckerrübensaatgut bestellen', assigneeEmployeeId: anna.id, dueOn: inDays(30), priority: 'low', status: 'open' });
  await tasks.create(ctx, { farmId: farm.id, title: 'Pachtverlängerung Kanalstück einreichen', assigneeEmployeeId: anna.id, dueOn: inDays(-10), priority: 'normal', status: 'done' });

  await seedMarschhof(app, ctx)
  await seedPlanningAndCompliance(app, ctx)
  log.log(`Seeded ${FIELDS.length} fields with two seasons of crops, operations, inventory, machinery and tasks.`);
  log.log(`Sign in as ${OWNER.email} (owner), jonas@example.com (manager), lena@example.com (worker), paul@example.com (accountant).`);
  await app.close();
}

/**
 * Second farm in Moormerland (Ostfriesland), inside Sentinel-2 tile T31UGV, so the satellite
 * pipeline has archived imagery to compute field statistics from. Idempotent.
 */
const MARSCHHOF: { name: string; crop: string; ring: [number, number][] }[] = [
  { name: 'Hofweide', crop: 'grassland', ring: [[7.284705, 53.301273], [7.286572, 53.301207], [7.286792, 53.300124], [7.284485, 53.300091]] },
  { name: 'Lange Fenne', crop: 'grassland', ring: [[7.287012, 53.300945], [7.289868, 53.300682], [7.289648, 53.299303], [7.286792, 53.299369]] },
  { name: 'Kampstück', crop: 'silage_maize', ring: [[7.290198, 53.300518], [7.292175, 53.300419], [7.292175, 53.298187], [7.289648, 53.298187]] },
  { name: 'Nordweide', crop: 'grassland', ring: [[7.289429, 53.304358], [7.292065, 53.304358], [7.29201, 53.301831], [7.290253, 53.301732]] },
  { name: 'Ostkamp', crop: 'grassland', ring: [[7.29256, 53.302586], [7.294812, 53.302652], [7.294812, 53.300419], [7.292285, 53.300485]] },
]

async function seedMarschhof(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, ctx: Ctx): Promise<boolean> {
  const farms = app.get(FarmsService)
  if ((await farms.list(ctx, true)).some((f) => f.name === 'Marschhof')) return false
  const farm = await farms.create(ctx, {
    name: 'Marschhof',
    address: 'Marschweg 12, 26802 Moormerland',
    country: 'DE',
    timezone: 'Europe/Berlin',
    location: { lat: 53.3022, lng: 7.2873 },
    mapZoom: 14,
    notes: 'Demo-Betrieb mit Sentinel-2-Abdeckung (Kachel T31UGV)',
  })
  const fieldsService = app.get(FieldsService)
  const crops = app.get(CropsService)
  const catalogue = await crops.crops(ctx)
  const season = (await crops.seasons(ctx)).find((s) => s.harvestYear === 2027)
  for (const f of MARSCHHOF) {
    const field = await fieldsService.create(ctx, { farmId: farm.id, name: f.name, tenure: 'owned', soilType: 'Marschklei', geometry: poly(f.ring) })
    if (season) {
      await crops.createCropCycles(ctx, { seasonId: season.id, fieldIds: [field.id], cropId: catalogue.find((c) => c.code === f.crop)!.id, status: 'active' })
    }
  }
  return true
}

/**
 * Cultivation planning, soil, nutrient, economics and regulatory demo data for Hof Sonnenfeld:
 * a rotation and a template, site data and soil samples, fertilizer types and catalogue products,
 * fertilizer-need records, crop prices, overheads and the farm's authority master data.
 * Idempotent: skipped when the rotation exists.
 */
async function seedPlanningAndCompliance(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, ctx: Ctx): Promise<boolean> {
  const db = app.get(Database)
  const planning = app.get(PlanningService)
  if ((await planning.rotations(ctx)).some((r) => r.name === 'Raps – Weizen – Gerste')) return false
  const farm = (await app.get(FarmsService).list(ctx, true)).find((f) => f.name === 'Hof Sonnenfeld')
  if (!farm) return false
  const crops = app.get(CropsService)
  const catalogue = await crops.crops(ctx)
  const crop = (code: string) => catalogue.find((c) => c.code === code)!.id
  const seasons = await crops.seasons(ctx)
  const s2026 = seasons.find((s) => s.harvestYear === 2026)!
  const s2027 = seasons.find((s) => s.harvestYear === 2027)!
  const fields = Object.fromEntries((await db.run(ctx, (trx) => trx.selectFrom('fields').select(['id', 'name']).where('farm_id', '=', farm.id).execute())).map((f) => [f.name, f.id]))

  // Site data and soil samples ------------------------------------------------
  const texture: Record<string, string> = { 'Große Breite': 'uL', 'Am Kirchweg': 'uL', 'Mühlenfeld': 'sL', 'Rübenacker': 'uL', 'Kanalstück': 'lS', 'Lange Wiese': 'tL', 'Hinterm Hof': 'uL' }
  const nutrients = app.get(NutrientsService)
  for (const [name, t] of Object.entries(texture)) {
    await nutrients.updateFieldSite(ctx, fields[name], { soilTexture: t as never, nitrateSensitiveZone: name === 'Kanalstück' })
  }
  const basic: [string, string, number, number, number, number, number][] = [
    ['Große Breite', '2024-09-12', 6.6, 14, 15, 9, 2.1],
    ['Am Kirchweg', '2024-09-12', 6.4, 9, 12, 7, 2.3],
    ['Mühlenfeld', '2022-09-20', 5.7, 7, 8, 5, 1.8],
    ['Rübenacker', '2024-09-12', 6.9, 18, 21, 10, 2.6],
    ['Kanalstück', '2019-10-02', 5.4, 6, 7, 4, 1.6],
    ['Lange Wiese', '2023-04-18', 5.9, 8, 14, 12, 5.2],
    ['Hinterm Hof', '2024-09-12', 6.5, 11, 13, 8, 2.2],
  ]
  for (const [name, date, ph, p2o5, k2o, mgo, humus] of basic) {
    await nutrients.createSoilSample(ctx, { fieldId: fields[name], kind: 'basic', sampledOn: date, lab: 'LUFA Nord-West (Demo)', sampleNumber: `B-${date.slice(0, 4)}-${name.slice(0, 3).toUpperCase()}`, ph, phMethod: 'cacl2', p2o5Mg100g: p2o5, pMethod: 'cal', k2oMg100g: k2o, mgoMg100g: mgo, humusPct: humus, soilTexture: texture[name] as never })
  }
  for (const [name, a, b, c] of [['Am Kirchweg', 18, 14, 9], ['Rübenacker', 22, 15, 11], ['Große Breite', 30, 21, 12]] as [string, number, number, number][]) {
    await nutrients.createSoilSample(ctx, { fieldId: fields[name], kind: 'nmin', sampledOn: '2026-02-24', lab: 'LUFA Nord-West (Demo)', nmin0to30: a, nmin30to60: b, nmin60to90: c })
  }

  // Product master data -------------------------------------------------------
  await db.run(ctx, async (trx) => {
    await trx.updateTable('products').set({ fertilizer_type: 'can', nh4_n_pct: 13.5, cao_pct: -15 }).where('name', 'like', 'Kalkammonsalpeter%').execute()
    await trx.updateTable('products').set({ fertilizer_type: 'can', nh4_n_pct: 19, cao_pct: -50 }).where('name', 'like', 'Ammonsulfatsalpeter%').execute()
    await trx.updateTable('products').set({ fertilizer_type: 'np', nh4_n_pct: 18 }).where('name', 'like', 'Diammonphosphat%').execute()
    await trx.updateTable('equipment').set({ fuel_l_per_h: 14 }).where('kind', '=', 'tractor').execute()
    await trx.updateTable('equipment').set({ fuel_l_per_h: 32 }).where('kind', '=', 'combine').execute()
  })
  const inventory = app.get(InventoryService)
  const pick = async (search: string, type?: string) => (await inventory.fertilizerCatalogue(ctx, { search, type }))[0]
  const slurryEntry = await pick('Rindergülle 8', 'cattle_slurry')
  const slurry = slurryEntry ? await inventory.createFromCatalogue(ctx, { catalogueEntryId: slurryEntry.id, name: 'Rindergülle (Nachbarbetrieb)' }) : null
  const ahlEntry = await pick('AHL 28', 'uan')
  if (ahlEntry) await inventory.createFromCatalogue(ctx, { catalogueEntryId: ahlEntry.id })
  // A real product from the BVL register, when it has been synced (pnpm sync:psm).
  await inventory.createFromPsm(ctx, { kennr: '025662-00', unitCost: 42 }).catch(() => null)

  // Planning: template, rotation, catch crop ----------------------------------
  const kas = (await inventory.products(ctx)).find((p) => p.name.startsWith('Kalkammonsalpeter'))!
  const ass = (await inventory.products(ctx)).find((p) => p.name.startsWith('Ammonsulfatsalpeter'))!
  // Prefer the product from the BVL register, so the approval checks have something to check.
  const protection = (await inventory.products(ctx)).filter((p) => p.category === 'crop_protection' && p.registrationNumber)
  const fungicide = protection.find((p) => p.psm) ?? protection[0]
  const wheatTemplate = await planning.createTemplate(ctx, {
    cropId: crop('winter_wheat'),
    name: 'Winterweizen nach Raps (Standard)',
    notes: 'Drei N-Gaben, zwei Fungizidbehandlungen',
    steps: [
      { type: 'fertilization', title: '1. N-Gabe', anchor: 'season_start', offsetDays: 214, bbchStage: '23', inputs: [{ productId: kas.id, ratePerHa: 220 }] },
      { type: 'fertilization', title: '2. N-Gabe mit Schwefel', anchor: 'season_start', offsetDays: 248, bbchStage: '31', inputs: [{ productId: ass.id, ratePerHa: 200 }] },
      { type: 'crop_protection', title: 'Fungizid T1', anchor: 'season_start', offsetDays: 260, bbchStage: '32', inputs: [{ productId: fungicide.id, ratePerHa: 1.0 }] },
      { type: 'fertilization', title: '3. N-Gabe (Qualität)', anchor: 'season_start', offsetDays: 280, bbchStage: '39', inputs: [{ productId: kas.id, ratePerHa: 150 }] },
      { type: 'crop_protection', title: 'Fungizid T2', anchor: 'season_start', offsetDays: 290, bbchStage: '49', inputs: [{ productId: fungicide.id, ratePerHa: 1.0 }] },
      { type: 'harvest', title: 'Drusch Winterweizen', anchor: 'harvest', offsetDays: 0, inputs: [] },
    ],
  })
  await planning.createTemplate(ctx, {
    cropId: crop('winter_rapeseed'),
    name: 'Winterraps Standard',
    steps: [
      { type: 'tillage', title: 'Stoppelbearbeitung', anchor: 'sowing', offsetDays: -14, inputs: [] },
      { type: 'sowing', title: 'Aussaat Winterraps', anchor: 'sowing', offsetDays: 0, inputs: [] },
      { type: 'fertilization', title: '1. N-Gabe Raps', anchor: 'season_start', offsetDays: 200, inputs: [{ productId: ass.id, ratePerHa: 250 }] },
      { type: 'harvest', title: 'Drusch Winterraps', anchor: 'harvest', offsetDays: 0, inputs: [] },
    ],
  })
  const rotation = await planning.createRotation(ctx, {
    name: 'Raps – Weizen – Gerste',
    entries: [
      { cropId: crop('winter_rapeseed'), expectedYieldTHa: 4.2 },
      { cropId: crop('winter_wheat'), templateId: wheatTemplate.id, expectedYieldTHa: 9 },
      { cropId: crop('winter_barley'), catchCropId: crop('cc_mustard'), expectedYieldTHa: 8 },
    ],
  })
  await planning.assignRotation(ctx, rotation.id, { fieldIds: [fields['Große Breite'], fields['Am Kirchweg'], fields['Mühlenfeld']], startYear: 2026 })
  const cycles2027 = await crops.cropCycles(ctx, { seasonId: s2027.id })
  const wheat2027 = cycles2027.find((c) => c.fieldName === 'Große Breite' && c.cropName.startsWith('Winterweizen'))
  if (wheat2027) await planning.applyTemplate(ctx, wheat2027.id, { templateId: wheatTemplate.id, replace: false })
  await crops.createCropCycles(ctx, { seasonId: s2027.id, fieldIds: [fields['Rübenacker']], cropId: crop('cc_mustard'), role: 'catch_crop', status: 'active', sowingDate: '2026-08-12' })
  if (slurry) {
    const ops = app.get(OperationsService)
    await ops.create(ctx, { farmId: farm.id, type: 'fertilization', title: 'Gülle zu Zuckerrüben', status: 'planned', plannedOn: '2027-03-25', fields: [{ fieldId: fields['Rübenacker'] }], inputs: [{ productId: slurry.id, ratePerHa: 25 }], labor: [], equipment: [], details: { applicationTechnique: 'trailing_shoe', incorporationHours: 4 } })
  }

  // Fertilizer need records of the current season -----------------------------
  for (const c of cycles2027.filter((x) => ['Große Breite', 'Am Kirchweg', 'Mühlenfeld', 'Rübenacker'].includes(x.fieldName))) {
    await nutrients.saveFertilizerNeed(ctx, c.id, { note: 'Demo: Planung Herbst 2026' }).catch(() => null)
  }

  // Economics -------------------------------------------------------------------
  const econ = app.get(Economics)
  await econ.saveCropPrices(ctx, { harvestYear: 2027, prices: [
    { cropId: crop('winter_wheat'), pricePerT: 210, notes: 'Vorkontrakt' }, { cropId: crop('winter_barley'), pricePerT: 190, notes: null },
    { cropId: crop('winter_rapeseed'), pricePerT: 480, notes: null }, { cropId: crop('sugar_beet'), pricePerT: 42, notes: null }, { cropId: crop('grain_maize'), pricePerT: 190, notes: null },
  ] })
  for (const s of [s2026, s2027]) {
    await econ.saveOverheads(ctx, { seasonId: s.id, leasePerHa: 180, landTaxPerHa: 25, insurancePerHa: 35, buildingsPerHa: 60, accountingPerHa: 20, otherPerHa: 30, basicPaymentPerHa: 156, redistributive1PerHa: 69, redistributive2PerHa: 41, ecoSchemesPerHa: 40, otherPaymentsPerHa: 0 })
  }
  await app.get(OperationsService).recordMissingEmissions(ctx)

  // Authority master data ------------------------------------------------------
  await app.get(RegulatoryService).saveFarmData(ctx, farm.id, {
    holdingNumber: '276031234567890', federalState: 'NI', fertilizerYearStart: 'JANUAR', organicCertified: false,
    enni: { soilClimateArea: 'BKR_45', nitrateZoneFlag: false }, endo: {},
    contact: { firma: 'Hof Sonnenfeld GbR', vorname: 'Anna', nachname: 'Bauer', strasse: 'Am Kanal 3', plz: '31319', ort: 'Sehnde', email: 'anna@example.com' },
    otherFertilizersApplied: false, compostApplied: false, restrictions: false,
  })
  return true
}

await main();
