/**
 * Machinery catalogue after AGVOLUTION/agmeo (src/lib/machinery/catalog.ts and its data): makes and
 * models of machines and implements with masses, tyres and working widths. Loaded once on first use.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CatalogueImplement,
  type CatalogueMachine,
  IMPLEMENT_TYPES,
  type ImplementType,
  MACHINE_CATEGORIES,
  type MachineCategory,
  MOUNT_TYPES,
  type MountType,
  type TyreSpec,
} from '@agmeo/contracts';

type RawMachine = Partial<Omit<CatalogueMachine, 'category'>> & { id: string; manufacturer: string; model: string; category: string };
type RawImplement = Partial<Omit<CatalogueImplement, 'type' | 'mountType'>> & { id: string; manufacturer: string; model: string; type: string; mountType?: string };

const dataFile = (name: string) => fileURLToPath(new URL(`../../../data/machinery-catalogue/${name}`, import.meta.url));

let machines: CatalogueMachine[] | null = null;
let implementsList: CatalogueImplement[] | null = null;

const tyre = (t: TyreSpec | null | undefined): TyreSpec | null => (t?.size ? t : null);

function loadMachines(): CatalogueMachine[] {
  machines ??= (JSON.parse(readFileSync(dataFile('machines.json'), 'utf-8')) as { machines: RawMachine[] }).machines.map((m) => ({
    id: m.id,
    manufacturer: m.manufacturer,
    model: m.model,
    yearRange: m.yearRange ?? null,
    category: (MACHINE_CATEGORIES as readonly string[]).includes(m.category) ? (m.category as MachineCategory) : 'other',
    powerKw: m.powerKw ?? null,
    emptyMassKg: m.emptyMassKg ?? null,
    operatingMassKg: m.operatingMassKg ?? null,
    frontAxleFraction: m.frontAxleFraction ?? null,
    tankCapacityL: m.tankCapacityL ?? null,
    frontTyre: tyre(m.frontTyre),
    rearTyre: tyre(m.rearTyre),
  }));
  return machines;
}

function loadImplements(): CatalogueImplement[] {
  implementsList ??= (JSON.parse(readFileSync(dataFile('implements.json'), 'utf-8')) as { implements: RawImplement[] }).implements.map((i) => ({
    id: i.id,
    manufacturer: i.manufacturer,
    model: i.model,
    // A few catalogue types have no own category here (forage harvester attachment, front loader).
    type: (IMPLEMENT_TYPES as readonly string[]).includes(i.type) ? (i.type as ImplementType) : 'other',
    mountType: i.mountType && (MOUNT_TYPES as readonly string[]).includes(i.mountType) ? (i.mountType as MountType) : null,
    emptyMassKg: i.emptyMassKg ?? null,
    maxFillMassKg: i.maxFillMassKg ?? null,
    workingWidthM: i.workingWidthM ?? null,
  }));
  return implementsList;
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[\s\-_./]/g, '').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');

export function catalogueManufacturers(kind: 'machine' | 'implement'): string[] {
  const list = kind === 'machine' ? loadMachines() : loadImplements();
  return [...new Set(list.map((m) => m.manufacturer))].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Models of a manufacturer, or a search over make and model; at most `limit` entries. */
export function catalogueSearch<K extends 'machine' | 'implement'>(
  kind: K,
  opts: { manufacturer?: string; q?: string; limit?: number },
): (K extends 'machine' ? CatalogueMachine : CatalogueImplement)[] {
  const list: (CatalogueMachine | CatalogueImplement)[] = kind === 'machine' ? loadMachines() : loadImplements();
  const words = (opts.q ?? '').split(/\s+/).map(normalize).filter(Boolean);
  return list
    .filter((m) => !opts.manufacturer || m.manufacturer === opts.manufacturer)
    .filter((m) => words.every((w) => normalize(`${m.manufacturer} ${m.model}`).includes(w)))
    .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer, 'de') || a.model.localeCompare(b.model, 'de'))
    .slice(0, Math.min(opts.limit ?? 100, 500)) as (K extends 'machine' ? CatalogueMachine : CatalogueImplement)[];
}
