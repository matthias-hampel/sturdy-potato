import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import { amount, id, isoDate, name, shortText } from './common.js';
import { FieldGeometry, TENURES } from './farms.js';

// ---------------------------------------------------------------------------
// Cadastral parcels (Flurstücke) from the federal states' cadastre services
// ---------------------------------------------------------------------------

/**
 * Outcome of a cadastre request: `no_access` for states without an open service (Bayern),
 * `unsupported` outside Germany, `no_coverage` when the service found nothing.
 */
export const CADASTRAL_STATUSES = ['ok', 'ok_slow', 'no_access', 'unavailable', 'unsupported', 'no_coverage', 'error'] as const;
export type CadastralStatus = (typeof CADASTRAL_STATUSES)[number];

export interface CadastralState {
  /** Federal state code, e.g. NI. */
  code: string;
  name: string;
  /** Source credit the data licence requires. */
  attribution: string;
}

/** A parcel as the cadastre service delivers it, before it is stored. */
export interface CadastralParcelCandidate {
  /** Flurstückskennzeichen. */
  officialId: string | null;
  label: string | null;
  /** Gemarkung. */
  district: string | null;
  /** Flur. */
  sector: string | null;
  numerator: string | null;
  denominator: string | null;
  /** Official area in m². */
  areaM2: number;
  geometry: MultiPolygon;
}

/** Map extent to look up parcels in; at most about 2.5 × 2.5 km. */
export const CadastralLookupQuery = z
  .object({
    west: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
    north: z.coerce.number().min(-90).max(90),
  })
  .refine((b) => b.east > b.west && b.north > b.south, 'Invalid extent')
  .refine((b) => b.east - b.west <= 0.04 && b.north - b.south <= 0.025, 'Extent too large; zoom in');
export type CadastralLookupQuery = z.input<typeof CadastralLookupQuery>;

export interface CadastralLookup {
  status: CadastralStatus;
  state: CadastralState | null;
  /** Why nothing could be fetched (no open service, service down). */
  message: string | null;
  parcels: CadastralParcelCandidate[];
}

const ParcelCandidateInput = z.object({
  officialId: z.string().trim().max(64).nullish(),
  label: shortText,
  district: z.string().trim().max(120).nullish(),
  sector: z.string().trim().max(20).nullish(),
  numerator: z.string().trim().max(20).nullish(),
  denominator: z.string().trim().max(20).nullish(),
  areaM2: amount.nullish(),
  geometry: FieldGeometry,
});

/** A new field made of parcels picked on the map; its boundary is their union. */
export const CreateFieldFromParcelsInput = z.object({
  farmId: id,
  name,
  /** Official identifier of the field (FLIK), if known. */
  identifier: shortText,
  tenure: z.enum(TENURES).default('owned'),
  /** Federal state the parcels came from. */
  state: z.string().trim().max(8).nullish(),
  parcels: z.array(ParcelCandidateInput).min(1).max(200),
});
export type CreateFieldFromParcelsInput = z.input<typeof CreateFieldFromParcelsInput>;

/** Fetches the parcels under the given fields (all active fields when none are given). */
export const SyncParcelsInput = z.object({ fieldIds: z.array(id).min(1).max(5000).optional() });
export type SyncParcelsInput = z.input<typeof SyncParcelsInput>;

export interface ParcelSyncFieldResult {
  fieldId: string;
  fieldName: string;
  status: CadastralStatus;
  state: string | null;
  /** New parcels stored. */
  inserted: number;
  /** Parcels already stored (left unchanged, so lease data is kept). */
  skipped: number;
  message: string | null;
}

export interface ParcelSyncResult {
  fields: ParcelSyncFieldResult[];
  inserted: number;
  skipped: number;
  /** Fields per status. */
  counts: Partial<Record<CadastralStatus, number>>;
}

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

export const LEASE_TYPES = ['ownership', 'lease_fixed_term', 'lease_indefinite', 'land_exchange', 'abandoned'] as const;
export type LeaseType = (typeof LEASE_TYPES)[number];
/** Rent per year for the whole parcel, or per hectare of its official area. */
export const RENT_BASES = ['per_year', 'per_ha'] as const;
export type RentBasis = (typeof RENT_BASES)[number];
/** Lease types collapsed for maps and analytics; `unknown` = no lease record. */
export type LeaseBucket = 'ownership' | 'leased' | 'land_exchange' | 'abandoned' | 'unknown';

export const leaseBucket = (type: LeaseType | null | undefined): LeaseBucket =>
  !type ? 'unknown' : type === 'lease_fixed_term' || type === 'lease_indefinite' ? 'leased' : type;

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const ParcelLeaseInput = z
  .object({
    leaseType: z.enum(LEASE_TYPES),
    ownerName: optText(200),
    ownerAddress: optText(500),
    leaseholderName: optText(200),
    rentAmount: amount.max(1e9).nullish(),
    rentBasis: z.enum(RENT_BASES).default('per_year'),
    startsOn: isoDate.nullish(),
    endsOn: isoDate.nullish(),
    landRegisterVolume: optText(50),
    landRegisterSheet: optText(50),
    landRegisterNumber: optText(50),
    notes: optText(2000),
  })
  .refine((l) => !l.startsOn || !l.endsOn || l.endsOn >= l.startsOn, { message: 'The lease must end after it starts', path: ['endsOn'] });
export type ParcelLeaseInput = z.input<typeof ParcelLeaseInput>;

export interface ParcelLease {
  leaseType: LeaseType;
  ownerName: string | null;
  ownerAddress: string | null;
  leaseholderName: string | null;
  rentAmount: number | null;
  rentBasis: RentBasis;
  startsOn: string | null;
  endsOn: string | null;
  landRegisterVolume: string | null;
  landRegisterSheet: string | null;
  landRegisterNumber: string | null;
  notes: string | null;
}

export interface CadastralParcel extends CadastralParcelCandidate {
  id: string;
  fieldId: string;
  fieldName: string;
  source: 'wfs' | 'manual';
  sourceState: string | null;
  syncedAt: string | null;
  lease: ParcelLease | null;
  /** Area of the parcel inside its field in m² (scaled to the official area). */
  fieldAreaM2: number | null;
  /** Share of the parcel inside its field (0–1). */
  fieldShare: number | null;
  /** Rent per year of the whole parcel, whatever the basis it was entered in. */
  rentPerYear: number | null;
  /** Rent per year of the part inside the field. */
  fieldRentPerYear: number | null;
}

export const LeaseAnalyticsQuery = z.object({
  /** Leases ending within this many months count as expiring. */
  months: z.coerce.number().int().min(1).max(60).default(12),
});

export interface LeaseFieldSummary {
  fieldId: string;
  fieldName: string;
  fieldAreaHa: number;
  ownedHa: number;
  leasedHa: number;
  /** Other kinds (land exchange, given up) and parcels without a lease record. */
  otherHa: number;
  /** Area of the field not covered by any stored parcel. */
  uncoveredHa: number;
  rentPerYear: number;
  /** Rent per leased hectare (only leases with a rent). */
  rentPerLeasedHa: number | null;
  /** Rent per hectare of the field, as derived from its parcels. */
  derivedLeasePerHa: number | null;
  /** The field's own lease per hectare, which wins over the derived one in economics. */
  leasePerHa: number | null;
  /** Lease per hectare economics uses for this field (own, else derived; null = farm default). */
  effectiveLeasePerHa: number | null;
}

export interface ExpiringLease {
  parcelId: string;
  fieldId: string;
  fieldName: string;
  label: string | null;
  ownerName: string | null;
  endsOn: string;
  daysLeft: number;
  rentPerYear: number | null;
}

export interface LeaseAnalytics {
  asOf: string;
  parcelCount: number;
  areaHa: number;
  ownedHa: number;
  leasedHa: number;
  rentPerYear: number;
  /** Rent per leased hectare, over leases with a rent. */
  rentPerLeasedHa: number | null;
  leasedParcels: number;
  leasedParcelsWithRent: number;
  byBucket: { bucket: LeaseBucket; areaHa: number; parcelCount: number; rentPerYear: number }[];
  fields: LeaseFieldSummary[];
  /** Leases ending within the requested months, and those already ended. */
  expiring: ExpiringLease[];
}

/** A parcel entered by hand (source `manual`), e.g. where the state has no open cadastre service. */
export const ManualParcelInput = z.object({
  fieldId: id,
  label: name,
  officialId: z.string().trim().max(64).nullish(),
  geometry: FieldGeometry,
});
export type ManualParcelInput = z.input<typeof ManualParcelInput>;
