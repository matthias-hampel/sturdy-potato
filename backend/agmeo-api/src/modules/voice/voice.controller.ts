import { pipeline } from 'node:stream/promises';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VOICE_DRAFT_STATUSES, VoiceConfirmInput, type VoiceDraftStatus, VoiceTextInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { VoiceService } from './voice.service.js';

/** Voice drafts (agmeo `voice-drafts`): dictations that become draft operations for review. */
@Controller('orgs/:orgId/voice-drafts')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** Whether recordings can be transcribed (speech-to-text configured). */
  @Get('config')
  config() {
    return this.voice.config();
  }

  @Get()
  list(@OrgCtx() ctx: Ctx, @Query('status') status?: string) {
    if (status != null && !(VOICE_DRAFT_STATUSES as readonly string[]).includes(status))
      throw badRequest('invalid_status', `Valid statuses: ${VOICE_DRAFT_STATUSES.join(', ')}`);
    return this.voice.list(ctx, status as VoiceDraftStatus | undefined);
  }

  /** A recording (multipart field `file`, optional `durationSec`); transcribed in the background. */
  @Post('audio')
  @Requires('operation.write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: config.voice.maxAudioBytes, files: 1 } }))
  audioUpload(@OrgCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown> | undefined) {
    if (!file?.buffer?.length) throw badRequest('no_file', 'No recording in the upload');
    const d = Number(body?.durationSec);
    return this.voice.uploadAudio(ctx, file, Number.isFinite(d) && d >= 0 && d < 36_000 ? Math.round(d * 100) / 100 : null);
  }

  /** A typed dictation, parsed at once. */
  @Post('text')
  @Requires('operation.write')
  text(@OrgCtx() ctx: Ctx, @ZBody(VoiceTextInput) input: Out<typeof VoiceTextInput>) {
    return this.voice.createText(ctx, input.transcript);
  }

  @Get(':id')
  get(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.get(ctx, id);
  }

  @Patch(':id')
  @Requires('operation.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(VoiceTextInput) input: Out<typeof VoiceTextInput>) {
    return this.voice.updateTranscript(ctx, id, input.transcript);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Requires('operation.write')
  confirm(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(VoiceConfirmInput) input: Out<typeof VoiceConfirmInput>) {
    return this.voice.confirm(ctx, id, input.operationId ?? null);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Requires('operation.write')
  reject(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.reject(ctx, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Requires('operation.write')
  retry(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.retry(ctx, id);
  }

  @Get(':id/audio')
  async audio(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { mime, bytes, stream } = await this.voice.audio(ctx, id);
    res.set({ 'content-type': mime, ...(bytes != null ? { 'content-length': String(bytes) } : {}), 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
    await pipeline(stream, res);
  }
}
