import { z } from 'zod';
import { id } from './common.js';
import type { OperationType } from './operations.js';

// ---------------------------------------------------------------------------
// Voice drafts (AGVOLUTION/agmeo lib/voice, VoiceDrafts): a dictation becomes a draft operation
// ---------------------------------------------------------------------------

/**
 * OperationDraft — the structured draft of a German farmer's dictation, the contract of the
 * reference's voice pipeline (agmeo-field voice spike): every key is always present, unknown values
 * are null, and the parser reports its gaps in `missing` and `confidence`.
 */
export const OPERATION_DRAFT_KINDS = ['operation', 'observation', 'note'] as const;
export type OperationDraftKind = (typeof OPERATION_DRAFT_KINDS)[number];

export const OPERATION_DRAFT_CATEGORIES = ['plantProtection', 'fertilization', 'sowing', 'tillage', 'harvest', 'irrigation', 'other'] as const;
export type OperationDraftCategory = (typeof OPERATION_DRAFT_CATEGORIES)[number];

/** The reference's units plus m³/ha, which slurry is documented in here. */
export const OPERATION_DRAFT_UNITS = ['l/ha', 'kg/ha', 't/ha', 'stk/ha', 'm3/ha'] as const;
export type OperationDraftUnit = (typeof OPERATION_DRAFT_UNITS)[number];

export const OPERATION_DRAFT_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type OperationDraftConfidence = (typeof OPERATION_DRAFT_CONFIDENCES)[number];

export interface OperationDraft {
  kind: OperationDraftKind;
  fieldName: string | null;
  category: OperationDraftCategory | null;
  articleName: string | null;
  quantity: number | null;
  unit: OperationDraftUnit | null;
  bbch: number | null;
  partialArea: boolean;
  partialAreaHa: number | null;
  windMs: number | null;
  tempC: number | null;
  /** 'heute', 'gestern' or an ISO date. */
  date: string | null;
  operatorHint: string | null;
  freeText: string;
  missing: string[];
  confidence: OperationDraftConfidence;
}

export const OPERATION_DRAFT_KEYS = [
  'kind',
  'fieldName',
  'category',
  'articleName',
  'quantity',
  'unit',
  'bbch',
  'partialArea',
  'partialAreaHa',
  'windMs',
  'tempC',
  'date',
  'operatorHint',
  'freeText',
  'missing',
  'confidence',
] as const satisfies readonly (keyof OperationDraft)[];

export type DraftValidation = { valid: true; draft: OperationDraft } | { valid: false; errors: string[] };

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => typeof value === 'string' && (options as readonly string[]).includes(value);
const isNullableString = (value: unknown) => value === null || typeof value === 'string';
const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

/**
 * Checks a draft against the contract (reference validateOperationDraft): all 16 keys, no extras,
 * then enum and type checks per key.
 */
export function validateOperationDraft(value: unknown): DraftValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { valid: false, errors: ['draft is not an object'] };
  const draft = value as Record<string, unknown>;
  for (const key of OPERATION_DRAFT_KEYS) if (!(key in draft)) errors.push(`missing key: ${key}`);
  for (const key of Object.keys(draft)) if (!(OPERATION_DRAFT_KEYS as readonly string[]).includes(key)) errors.push(`unexpected key: ${key}`);
  if (errors.length > 0) return { valid: false, errors };

  if (!isOneOf(draft.kind, OPERATION_DRAFT_KINDS)) errors.push(`kind: invalid value ${JSON.stringify(draft.kind)}`);
  if (!isNullableString(draft.fieldName)) errors.push('fieldName: must be string or null');
  if (draft.category !== null && !isOneOf(draft.category, OPERATION_DRAFT_CATEGORIES)) errors.push(`category: invalid value ${JSON.stringify(draft.category)}`);
  if (!isNullableString(draft.articleName)) errors.push('articleName: must be string or null');
  if (!isNullableNumber(draft.quantity)) errors.push('quantity: must be number or null');
  if (draft.unit !== null && !isOneOf(draft.unit, OPERATION_DRAFT_UNITS)) errors.push(`unit: invalid value ${JSON.stringify(draft.unit)}`);
  if (draft.bbch !== null && (!Number.isInteger(draft.bbch) || (draft.bbch as number) < 0 || (draft.bbch as number) > 99)) {
    errors.push(`bbch: must be an integer 0-99 or null, got ${JSON.stringify(draft.bbch)}`);
  }
  if (typeof draft.partialArea !== 'boolean') errors.push('partialArea: must be boolean');
  if (!isNullableNumber(draft.partialAreaHa)) errors.push('partialAreaHa: must be number or null');
  if (!isNullableNumber(draft.windMs)) errors.push('windMs: must be number or null');
  if (!isNullableNumber(draft.tempC)) errors.push('tempC: must be number or null');
  if (!isNullableString(draft.date)) errors.push('date: must be string or null');
  if (!isNullableString(draft.operatorHint)) errors.push('operatorHint: must be string or null');
  if (typeof draft.freeText !== 'string') errors.push('freeText: must be a string');
  if (!Array.isArray(draft.missing) || draft.missing.some((m) => typeof m !== 'string')) errors.push('missing: must be an array of strings');
  if (!isOneOf(draft.confidence, OPERATION_DRAFT_CONFIDENCES)) errors.push(`confidence: invalid value ${JSON.stringify(draft.confidence)}`);
  return errors.length > 0 ? { valid: false, errors } : { valid: true, draft: draft as unknown as OperationDraft };
}

/** Draft categories → agmeo operation types; observations become field inspections. */
export const DRAFT_OPERATION_TYPE: Record<OperationDraftCategory, OperationType> = {
  plantProtection: 'crop_protection',
  fertilization: 'fertilization',
  sowing: 'sowing',
  tillage: 'tillage',
  harvest: 'harvest',
  irrigation: 'irrigation',
  other: 'other',
};

export const VOICE_DRAFT_STATUSES = ['pending', 'transcribing', 'draft', 'confirmed', 'rejected', 'failed'] as const;
export type VoiceDraftStatus = (typeof VOICE_DRAFT_STATUSES)[number];

/** What the draft resolved to in the organization: the field, the product and its rate in the product's unit. */
export interface VoiceDraftResolution {
  fieldId: string | null;
  fieldName: string | null;
  productId: string | null;
  productName: string | null;
  operationType: OperationType;
  /** Rate in the product's base unit per hectare; null when the spoken unit does not convert. */
  ratePerHa: number | null;
  /** ISO day the work was done on, from 'heute', 'gestern' or a date. */
  performedOn: string | null;
}

export interface VoiceDraft {
  id: string;
  source: 'audio' | 'text';
  status: VoiceDraftStatus;
  hasAudio: boolean;
  durationSec: number | null;
  transcript: string | null;
  draft: OperationDraft | null;
  resolved: VoiceDraftResolution | null;
  missing: string[];
  confidence: OperationDraftConfidence | null;
  error: string | null;
  operationId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface VoiceConfig {
  /** Speech-to-text service configured (VOICE_STT_URL); without it recordings are refused. */
  transcription: boolean;
  maxAudioBytes: number;
}

export const VoiceTextInput = z.object({ transcript: z.string().trim().min(1).max(20_000) });
export type VoiceTextInput = z.input<typeof VoiceTextInput>;

export const VoiceConfirmInput = z.object({ operationId: id.nullish() });
export type VoiceConfirmInput = z.input<typeof VoiceConfirmInput>;
