import { Controller, Delete, Get, HttpCode, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UnsubscribeInput, UpdateNotificationSettingsInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { type AuthUser, type Ctx, CurrentUser, OrgCtx, Public, Requires } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { type Out, ZBody } from '../../core/validation.js';
import { MAX_LOGO_BYTES, OrgSettingsService } from './org-settings.service.js';

const LOGO_UPLOAD = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_LOGO_BYTES + 1, files: 1 } });

/** Settings tabs of the reference app: logo, notification e-mails, organization export. */
@Controller()
export class OrgSettingsController {
  constructor(private readonly settings: OrgSettingsService) {}

  /** The organization's logo (any member; the app and print views show it). */
  @Get('orgs/:orgId/logo')
  async logo(@OrgCtx() ctx: Ctx, @Res() res: Response) {
    const logo = await this.settings.logo(ctx);
    res.set({ 'content-type': logo.mimeType, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
    res.send(logo.content);
  }

  @Put('orgs/:orgId/logo')
  @HttpCode(204)
  @Requires('org.manage')
  @UseInterceptors(LOGO_UPLOAD)
  setLogo(@OrgCtx() ctx: Ctx, @UploadedFile() file?: Express.Multer.File) {
    return this.settings.setLogo(ctx, file?.buffer);
  }

  @Delete('orgs/:orgId/logo')
  @HttpCode(204)
  @Requires('org.manage')
  deleteLogo(@OrgCtx() ctx: Ctx) {
    return this.settings.deleteLogo(ctx);
  }

  /** Everything the organization stored, as a ZIP of CSV or JSON files plus field boundaries. */
  @Get('orgs/:orgId/export')
  @Requires('members.manage')
  async export(@OrgCtx() ctx: Ctx, @Query('format') format: string | undefined, @Res() res: Response) {
    const f = format ?? 'csv';
    if (f !== 'csv' && f !== 'json') throw badRequest('invalid_format', 'format must be csv or json');
    const file = await this.settings.exportOrganization(ctx, f);
    res.set({ 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"` });
    res.send(file.data);
  }

  /** Settings → Data processing: who processes data for this deployment. */
  @Get('orgs/:orgId/data-processing')
  dataProcessing(@OrgCtx() _ctx: Ctx) {
    return this.settings.dataProcessors();
  }

  @Get('me/notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.settings.notifications(user.userId);
  }

  @Put('me/notifications')
  updateNotifications(@CurrentUser() user: AuthUser, @ZBody(UpdateNotificationSettingsInput) input: Out<typeof UpdateNotificationSettingsInput>) {
    return this.settings.updateNotifications(user.userId, input);
  }

  /** Unsubscribe page of a notification e-mail (token from the link; no sign-in). */
  @Post('notifications/unsubscribe')
  @HttpCode(200)
  @Public()
  unsubscribe(@ZBody(UnsubscribeInput) input: Out<typeof UnsubscribeInput>) {
    return this.settings.unsubscribe(input.token);
  }

  /** RFC 8058 one-click unsubscribe: mail clients POST to the List-Unsubscribe URL with the token in the query. */
  @Post('notifications/unsubscribe/one-click')
  @HttpCode(200)
  @Public()
  async oneClick(@Query('token') token: string | undefined) {
    await this.settings.unsubscribe(token ?? '');
    return { ok: true };
  }
}
