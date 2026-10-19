import { Controller, Get } from '@nestjs/common';
import { SearchQuery } from '@agmeo/contracts';
import { type Ctx, OrgCtx } from '../../auth/context.js';
import { type Out, ZQuery } from '../../core/validation.js';
import { SearchService } from './search.service.js';

@Controller('orgs/:orgId/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@OrgCtx() ctx: Ctx, @ZQuery(SearchQuery) query: Out<typeof SearchQuery>) {
    return this.search.search(ctx, query);
  }
}
