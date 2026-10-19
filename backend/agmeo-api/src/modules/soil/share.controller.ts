import { Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { SoilShareAccessInput } from '@agmeo/contracts';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Public } from '../../auth/context.js';
import { type Out, ZBody } from '../../core/validation.js';
import { contentDisposition } from '../files/names.js';
import { SoilShareService } from './share.service.js';

/** Public soil share pages: no sign-in, the link token (and password) grant access. */
@Controller('share/soil/:token')
export class SoilSharePublicController {
  constructor(private readonly shares: SoilShareService) {}

  @Get()
  @Public()
  info(@Param('token') token: string) {
    return this.shares.publicInfo(token);
  }

  /** Opens the share with the password, or with the access token of an earlier visit (header x-share-access). */
  @Post('open')
  @HttpCode(200)
  @Public()
  open(@Param('token') token: string, @ZBody(SoilShareAccessInput) input: Out<typeof SoilShareAccessInput>, @Headers('x-share-access') access?: string) {
    return this.shares.open(token, input.password, access);
  }

  @Get('file')
  @Public()
  async file(@Param('token') token: string, @Query('access') access: string | undefined, @Res() res: Response) {
    const file = await this.shares.file(token, access);
    res.set({
      'content-type': 'application/octet-stream',
      'content-length': String(file.size),
      'content-disposition': contentDisposition(file.name),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    await pipeline(file.stream, res);
  }
}
