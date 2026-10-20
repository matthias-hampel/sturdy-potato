import { pipeline } from 'node:stream/promises';
import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { RadarManifest } from '@agmeo/contracts';
import type { Response } from 'express';
import { type AuthUser, CurrentUser } from '../../auth/context.js';
import { RadarService } from './radar.service.js';

/** DWD precipitation radar. Not organization-scoped, but only for signed-in users. */
@Controller('radar')
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  @Get('manifest')
  @Header('cache-control', 'private, no-cache')
  manifest(@CurrentUser() user: AuthUser): Promise<RadarManifest> {
    return this.radar.manifest(user.userId);
  }

  /** A frame key names one run and lead time for good, so a frame never changes. */
  @Get('frames/:key.png')
  async frame(@CurrentUser() user: AuthUser, @Param('key') key: string, @Res() res: Response) {
    const stream = await this.radar.frame(user.userId, key);
    res.set({
      'content-type': 'image/png',
      // private: the endpoint needs a sign-in, so shared caches must not serve it to anyone.
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
    });
    await pipeline(stream, res);
  }
}
