import { tmpdir } from 'node:os';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { LinkDocumentsInput } from '@agmeo/contracts';
import { diskStorage } from 'multer';
import { z } from 'zod';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { FieldDocumentsService } from './field-documents.service.js';

const MAX_FILES = 20;

const UploadFields = z.object({
  harvestYear: z.coerce.number().int().min(1900).max(2200).nullable().catch(null),
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

@Controller('orgs/:orgId/fields/:fieldId/documents')
export class FieldDocumentsController {
  constructor(private readonly documents: FieldDocumentsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Query('harvestYear') harvestYear?: string) {
    const year = harvestYear ? Number(harvestYear) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2200)) throw badRequest('invalid_year', 'Invalid harvest year');
    return this.documents.list(ctx, fieldId, year);
  }

  @Post()
  @Requires('files.write')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: config.storage.maxUploadBytes, files: MAX_FILES },
    }),
  )
  upload(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @UploadedFiles() uploaded: Express.Multer.File[] = [], @Body() body: unknown) {
    const fields = UploadFields.safeParse(body);
    if (!fields.success || fields.data.names.length !== uploaded.length) throw badRequest('invalid_upload', 'Every uploaded file needs a name');
    return this.documents.upload(
      ctx,
      fieldId,
      fields.data.harvestYear,
      uploaded.map((f, i) => ({ path: f.path, size: f.size, mimetype: f.mimetype, name: fields.data.names[i] })),
    );
  }

  @Post('link')
  @Requires('files.write')
  link(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @ZBody(LinkDocumentsInput) input: Out<typeof LinkDocumentsInput>) {
    return this.documents.link(ctx, fieldId, input);
  }

  @Delete(':fileId')
  @HttpCode(204)
  @Requires('files.write')
  unlink(@OrgCtx() ctx: Ctx, @Param('fieldId', ParseUUIDPipe) fieldId: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.documents.unlink(ctx, fieldId, fileId);
  }
}
