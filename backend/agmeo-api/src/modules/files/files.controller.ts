import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  CompressItemsInput,
  CreateFolderInput,
  CreateFolderTreeInput,
  ItemSelection,
  MoveItemsInput,
  UpdateFileInput,
  UpdateFolderInput,
} from '@agmeo/contracts';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { z } from 'zod';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { FilesService } from './files.service.js';
import { contentDisposition, isSafeInline } from './names.js';

const MAX_FILES_PER_UPLOAD = 100;

const UploadFields = z.object({
  folderId: z.uuid().nullable().catch(null),
  year: z.coerce.number().int().min(1900).max(2200).nullable().catch(null),
  // File names as JSON array, in upload order: multipart file names are not reliably UTF-8.
  names: z.string().transform((s, c) => {
    try {
      return z.array(z.string().min(1).max(1000)).parse(JSON.parse(s));
    } catch {
      c.addIssue({ code: 'custom', message: 'names must be a JSON array of strings' });
      return z.NEVER;
    }
  }),
});

const optionalUuid = (v: unknown) => (typeof v === 'string' && v ? z.uuid().parse(v) : null);

@Controller('orgs/:orgId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  listing(@OrgCtx() ctx: Ctx, @Query('folderId') folderId?: string, @Query('search') search?: string) {
    return this.files.listing(ctx, optionalUuid(folderId), search);
  }

  @Get('folders')
  folders(@OrgCtx() ctx: Ctx) {
    return this.files.folders(ctx);
  }

  @Get('storage')
  usage(@OrgCtx() ctx: Ctx) {
    return this.files.usage(ctx);
  }

  @Get('trash')
  trash(@OrgCtx() ctx: Ctx) {
    return this.files.trash(ctx);
  }

  @Post('upload')
  @Requires('files.write')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: config.storage.maxUploadBytes, files: MAX_FILES_PER_UPLOAD },
    }),
  )
  async upload(@OrgCtx() ctx: Ctx, @UploadedFiles() uploaded: Express.Multer.File[] = [], @Body() body: unknown) {
    const fields = UploadFields.safeParse(body);
    if (!fields.success || fields.data.names.length !== uploaded.length) throw badRequest('invalid_upload', 'Every uploaded file needs a name');
    const { folderId, year, names } = fields.data;
    return this.files.upload(
      ctx,
      folderId,
      year,
      uploaded.map((f, i) => ({ path: f.path, size: f.size, mimetype: f.mimetype, name: names[i] })),
    );
  }

  @Post('folders')
  @Requires('files.write')
  createFolder(@OrgCtx() ctx: Ctx, @ZBody(CreateFolderInput) input: Out<typeof CreateFolderInput>) {
    return this.files.createFolder(ctx, input);
  }

  @Post('folders/tree')
  @Requires('files.write')
  createFolderTree(@OrgCtx() ctx: Ctx, @ZBody(CreateFolderTreeInput) input: Out<typeof CreateFolderTreeInput>) {
    return this.files.createFolderTree(ctx, input);
  }

  @Patch('folders/:id')
  @Requires('files.write')
  updateFolder(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateFolderInput) input: Out<typeof UpdateFolderInput>) {
    return this.files.updateFolder(ctx, id, input);
  }

  @Get('folders/:id/zip')
  async folderZip(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { name, stream } = await this.files.folderZip(ctx, id);
    res.set({ 'content-type': 'application/zip', 'content-disposition': contentDisposition(name), 'cache-control': 'private, no-store' });
    await pipeline(stream, res);
  }

  @Post('move')
  @HttpCode(204)
  @Requires('files.write')
  move(@OrgCtx() ctx: Ctx, @ZBody(MoveItemsInput) input: Out<typeof MoveItemsInput>) {
    return this.files.move(ctx, input);
  }

  @Post('copy')
  @HttpCode(204)
  @Requires('files.write')
  copy(@OrgCtx() ctx: Ctx, @ZBody(MoveItemsInput) input: Out<typeof MoveItemsInput>) {
    return this.files.copy(ctx, input);
  }

  @Post('delete')
  @HttpCode(204)
  @Requires('files.write')
  remove(@OrgCtx() ctx: Ctx, @ZBody(ItemSelection) input: Out<typeof ItemSelection>) {
    return this.files.remove(ctx, input);
  }

  @Post('trash/restore')
  @HttpCode(204)
  @Requires('files.write')
  restore(@OrgCtx() ctx: Ctx, @ZBody(ItemSelection) input: Out<typeof ItemSelection>) {
    return this.files.restore(ctx, input);
  }

  @Delete('trash')
  @Requires('files.write')
  emptyTrash(@OrgCtx() ctx: Ctx) {
    return this.files.emptyTrash(ctx);
  }

  @Post('compress')
  @Requires('files.write')
  compress(@OrgCtx() ctx: Ctx, @ZBody(CompressItemsInput.extend({ name: z.string().trim().min(1).max(200) })) input: Out<typeof CompressItemsInput> & { name: string }) {
    return this.files.compress(ctx, input);
  }

  @Get(':id')
  file(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.file(ctx, id);
  }

  @Patch(':id')
  @Requires('files.write')
  updateFile(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateFileInput) input: Out<typeof UpdateFileInput>) {
    return this.files.updateFile(ctx, id, input);
  }

  @Post(':id/extract')
  @Requires('files.write')
  extract(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.extract(ctx, id);
  }

  /**
   * The file's bytes. `inline=1` lets images and PDFs display in the app; anything else
   * always downloads, and the sandbox CSP keeps an uploaded document from running script
   * under the app's origin.
   */
  @Get(':id/content')
  async content(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const { file, stream } = await this.files.content(ctx, id);
    const asInline = inline === '1' && isSafeInline(file.mimeType);
    res.set({
      'content-type': asInline ? file.mimeType : 'application/octet-stream',
      'content-length': String(file.sizeBytes),
      'content-disposition': contentDisposition(file.name, asInline),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'cache-control': 'private, max-age=300',
    });
    await pipeline(stream, res);
  }
}
