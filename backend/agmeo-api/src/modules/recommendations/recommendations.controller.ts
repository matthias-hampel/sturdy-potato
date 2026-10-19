import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AcceptRecommendationInput, DismissRecommendationInput, RecommendationListQuery } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { RecommendationsService } from './recommendations.service.js';

@Controller('orgs/:orgId/recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @ZQuery(RecommendationListQuery) query: Out<typeof RecommendationListQuery>) {
    return this.recommendations.list(ctx, query);
  }

  /** Recomputes the recommendations from the current calendar, weather and satellite data. */
  @Post('refresh')
  @HttpCode(200)
  refresh(@OrgCtx() ctx: Ctx) {
    return this.recommendations.refresh(ctx);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Requires('task.write')
  accept(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(AcceptRecommendationInput) input: Out<typeof AcceptRecommendationInput>) {
    return this.recommendations.accept(ctx, id, input);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @Requires('task.write')
  dismiss(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(DismissRecommendationInput) input: Out<typeof DismissRecommendationInput>) {
    return this.recommendations.dismiss(ctx, id, input);
  }
}
