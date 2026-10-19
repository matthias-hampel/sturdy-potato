import { Controller, Get } from '@nestjs/common';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { NewsService } from './news.service.js';

@Controller('orgs/:orgId/news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  feed(@OrgCtx() ctx: Ctx) {
    return this.news.feed(ctx);
  }
}
