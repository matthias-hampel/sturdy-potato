import { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import type { OperationDraft, OperationDraftConfidence, VoiceConfig, VoiceDraft, VoiceDraftResolution, VoiceDraftStatus } from '@agmeo/contracts';
import type { Kysely, Selectable } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest, conflict, DomainError, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import type { DB, VoiceDrafts } from '../../db/schema.js';
import { enqueue } from '../../jobs/queue.js';
import type { JobHandler } from '../../jobs/runner.js';
import { ObjectStorage, type StorageDriver } from '../../storage/object-storage.js';
import { parseDictation, type VoiceVocabulary } from './parse.js';
import { sttConfigured, transcribe } from './stt.js';

export const VOICE_TRANSCRIBE = 'voice.transcribe';

const AUDIO_MIME = /^audio\/(webm|ogg|mp4|m4a|x-m4a|aac|mpeg|wav|x-wav|flac)(;.*)?$/;

type Row = Selectable<VoiceDrafts>;

const toDraft = (r: Row): VoiceDraft => ({
  id: r.id,
  source: r.source as VoiceDraft['source'],
  status: r.status as VoiceDraftStatus,
  hasAudio: r.audio_key != null,
  durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
  transcript: r.transcript,
  draft: (r.draft as OperationDraft | null) ?? null,
  resolved: (r.resolved as VoiceDraftResolution | null) ?? null,
  missing: (r.missing as string[] | null) ?? [],
  confidence: (r.confidence as OperationDraftConfidence | null) ?? null,
  error: r.error,
  operationId: r.operation_id,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  createdBy: r.created_by,
});

/** The organization's active fields and products, the names a dictation is matched against. */
export async function loadVocabulary(db: Kysely<DB> | Trx, orgId: string): Promise<VoiceVocabulary> {
  const [fields, products] = await Promise.all([
    db.selectFrom('fields').select(['id', 'name']).where('organization_id', '=', orgId).where('status', '=', 'active').execute(),
    db
      .selectFrom('products')
      .select(['id', 'name', 'category', 'base_unit'])
      .where('organization_id', '=', orgId)
      .where('archived_at', 'is', null)
      .execute(),
  ]);
  return { fields, products: products.map((p) => ({ id: p.id, name: p.name, category: p.category, baseUnit: p.base_unit })) };
}

/** Today in the farm's time zone (the reference app works in Europe/Berlin). */
export const berlinDay = (d: Date = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

const parsedColumns = (parsed: ReturnType<typeof parseDictation>) => ({
  draft: JSON.stringify(parsed.draft),
  resolved: JSON.stringify(parsed.resolved),
  missing: JSON.stringify(parsed.draft.missing),
  confidence: parsed.draft.confidence,
});

/**
 * The transcription job: claims a pending recording, sends it to the speech-to-text service and
 * parses the transcript into a draft. Errors end on the draft (`failed` with the reason) so a bad
 * recording does not stall the queue; the user can retry it.
 */
export function voiceTranscribeHandler(db: Kysely<DB>, storage: StorageDriver, logger = new Logger('VoiceTranscription')): JobHandler {
  return async (job) => {
    const id = job.payload.draftId as string | undefined;
    if (!id) return;
    const claimed = await db
      .updateTable('voice_drafts')
      .set({ status: 'transcribing', error: null, updated_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returning(['id', 'organization_id', 'audio_key', 'audio_mime', 'created_at'])
      .executeTakeFirst();
    if (!claimed) return;
    const fail = async (message: string) => {
      logger.warn(`Voice draft ${id} failed: ${message}`);
      await db.updateTable('voice_drafts').set({ status: 'failed', error: message.slice(0, 2000), updated_at: new Date() }).where('id', '=', id).execute();
    };
    try {
      if (!claimed.audio_key) return await fail('no recording');
      const chunks: Buffer[] = [];
      for await (const chunk of await storage.get(claimed.audio_key)) chunks.push(Buffer.from(chunk as Buffer));
      const transcript = await transcribe(Buffer.concat(chunks), claimed.audio_mime ?? 'audio/webm');
      if (!transcript) {
        await db.updateTable('voice_drafts').set({ transcript: '' }).where('id', '=', id).execute();
        return await fail('empty transcript');
      }
      const parsed = parseDictation(transcript, await loadVocabulary(db, claimed.organization_id), berlinDay(new Date(claimed.created_at)));
      await db
        .updateTable('voice_drafts')
        .set({ status: 'draft', transcript, ...parsedColumns(parsed), error: null, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    } catch (e) {
      await fail(e instanceof Error ? e.message : String(e));
    }
  };
}

/** Voice drafts: recordings and typed dictations, their drafts and the user's decision. */
@Injectable()
export class VoiceService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
  ) {}

  config(): VoiceConfig {
    return { transcription: sttConfigured(), maxAudioBytes: config.voice.maxAudioBytes };
  }

  list(ctx: Ctx, status?: VoiceDraftStatus): Promise<VoiceDraft[]> {
    return this.db.run(ctx, async (trx) => {
      let q = trx.selectFrom('voice_drafts').selectAll().orderBy('created_at', 'desc').limit(200);
      if (status) q = q.where('status', '=', status);
      return (await q.execute()).map(toDraft);
    });
  }

  private async row(trx: Trx, id: string): Promise<Row> {
    const r = await trx.selectFrom('voice_drafts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Voice draft');
    return r;
  }

  get(ctx: Ctx, id: string): Promise<VoiceDraft> {
    return this.db.run(ctx, async (trx) => toDraft(await this.row(trx, id)));
  }

  /** Stores a recording and queues its transcription; refused while no speech-to-text service is configured. */
  async uploadAudio(ctx: Ctx, file: { buffer: Buffer; mimetype: string }, durationSec: number | null): Promise<VoiceDraft> {
    if (!sttConfigured()) throw new DomainError(503, 'service_not_configured', 'Speech-to-text is not configured', { service: 'stt' });
    if (!file.buffer.length) throw badRequest('no_file', 'No recording in the upload');
    if (!AUDIO_MIME.test(file.mimetype)) throw badRequest('invalid_audio', 'Upload an audio recording (WebM, Ogg, MP4/M4A, MP3, WAV or FLAC)');
    const mime = file.mimetype.split(';')[0];
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('voice_drafts')
        .values({
          organization_id: ctx.orgId,
          source: 'audio',
          status: 'pending',
          audio_mime: mime,
          audio_bytes: file.buffer.length,
          duration_sec: durationSec,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const key = `orgs/${ctx.orgId}/voice/${id}`;
      await this.storage.put(key, Readable.from([file.buffer]), mime, file.buffer.length);
      await trx.updateTable('voice_drafts').set({ audio_key: key }).where('id', '=', id).execute();
      await enqueue(trx, { kind: VOICE_TRANSCRIBE, organizationId: ctx.orgId, payload: { draftId: id }, dedupeKey: id, maxAttempts: 2 });
      await record(trx, ctx, { entityType: 'voice_draft', entityId: id, action: 'recorded', changes: { bytes: file.buffer.length } });
      return toDraft(await this.row(trx, id));
    });
  }

  /** A typed (or pasted) dictation becomes a draft at once; no speech-to-text needed. */
  createText(ctx: Ctx, transcript: string): Promise<VoiceDraft> {
    return this.db.run(ctx, async (trx) => {
      const parsed = parseDictation(transcript, await loadVocabulary(trx, ctx.orgId), berlinDay());
      const { id } = await trx
        .insertInto('voice_drafts')
        .values({ organization_id: ctx.orgId, source: 'text', status: 'draft', transcript, ...parsedColumns(parsed), created_by: ctx.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'voice_draft', entityId: id, action: 'created', changes: { kind: parsed.draft.kind } });
      return toDraft(await this.row(trx, id));
    });
  }

  /** Corrects the transcript and parses it again (open or failed drafts). */
  updateTranscript(ctx: Ctx, id: string, transcript: string): Promise<VoiceDraft> {
    return this.db.run(ctx, async (trx) => {
      const r = await this.row(trx, id);
      if (r.status !== 'draft' && r.status !== 'failed') throw conflict('voice_draft_resolved', `The draft cannot be edited (status: ${r.status})`);
      const parsed = parseDictation(transcript, await loadVocabulary(trx, ctx.orgId), berlinDay(new Date(r.created_at)));
      await trx
        .updateTable('voice_drafts')
        .set({ transcript, status: 'draft', error: null, ...parsedColumns(parsed), updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      return toDraft(await this.row(trx, id));
    });
  }

  /**
   * Accepts a draft (reference POST voice-drafts/{id}/confirm), optionally with the operation
   * created from it. Confirming twice replays; resolved drafts otherwise conflict.
   */
  confirm(ctx: Ctx, id: string, operationId: string | null): Promise<VoiceDraft> {
    return this.resolveAs(ctx, id, 'confirmed', operationId);
  }

  reject(ctx: Ctx, id: string): Promise<VoiceDraft> {
    return this.resolveAs(ctx, id, 'rejected', null);
  }

  private resolveAs(ctx: Ctx, id: string, target: 'confirmed' | 'rejected', operationId: string | null): Promise<VoiceDraft> {
    return this.db.run(ctx, async (trx) => {
      if (operationId) {
        const op = await trx.selectFrom('operations').select('id').where('id', '=', operationId).executeTakeFirst();
        if (!op) throw notFound('Operation');
      }
      const updated = await trx
        .updateTable('voice_drafts')
        .set({ status: target, operation_id: operationId, resolved_at: new Date(), resolved_by: ctx.userId, updated_at: new Date() })
        .where('id', '=', id)
        .where('status', 'in', target === 'rejected' ? ['draft', 'failed'] : ['draft'])
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        await record(trx, ctx, { entityType: 'voice_draft', entityId: id, action: target, changes: { operationId } });
        return toDraft(updated);
      }
      const r = await this.row(trx, id);
      if (r.status === target) return toDraft(r);
      throw conflict('voice_draft_not_open', `The draft is not open (status: ${r.status})`, { status: r.status });
    });
  }

  /** Queues a failed recording again. */
  retry(ctx: Ctx, id: string): Promise<VoiceDraft> {
    if (!sttConfigured()) throw new DomainError(503, 'service_not_configured', 'Speech-to-text is not configured', { service: 'stt' });
    return this.db.run(ctx, async (trx) => {
      const r = await this.row(trx, id);
      if (r.status !== 'failed' || !r.audio_key) throw conflict('voice_draft_not_failed', 'Only failed recordings can be transcribed again');
      await trx.updateTable('voice_drafts').set({ status: 'pending', error: null, updated_at: new Date() }).where('id', '=', id).execute();
      await enqueue(trx, { kind: VOICE_TRANSCRIBE, organizationId: ctx.orgId, payload: { draftId: id }, dedupeKey: `${id}:${Date.now()}`, maxAttempts: 2 });
      return toDraft(await this.row(trx, id));
    });
  }

  async audio(ctx: Ctx, id: string) {
    const r = await this.db.run(ctx, (trx) => this.row(trx, id));
    if (!r.audio_key) throw notFound('Recording');
    return { mime: r.audio_mime ?? 'audio/webm', bytes: r.audio_bytes, stream: await this.storage.get(r.audio_key) };
  }
}
