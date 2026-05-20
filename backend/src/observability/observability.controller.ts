import { Controller, Get, Param, Query } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

@Controller('runs')
export class ObservabilityController {
  constructor(private readonly observability: ObservabilityService) {}

  /**
   * GET /api/v1/runs
   * Paginated list of agent runs, newest first.
   * Query params: userId, skill, limit, offset, from (ISO), to (ISO)
   */
  @Get()
  list(
    @Query('userId') userId?: string,
    @Query('skill')  skill?: string,
    @Query('limit')  limit?: string,
    @Query('offset') offset?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.observability.listRuns({
      userId,
      skill,
      limit:  limit  ? parseInt(limit)  : undefined,
      offset: offset ? parseInt(offset) : undefined,
      from,
      to,
    });
  }

  /**
   * GET /api/v1/runs/stats
   * Aggregate stats — total runs, tokens, cost, breakdowns by skill and model.
   * Query params: userId, from (ISO), to (ISO)
   */
  @Get('stats')
  stats(
    @Query('userId') userId?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.observability.getStats({ userId, from, to });
  }

  /**
   * GET /api/v1/runs/:runId
   * Full detail for a single run including steps array.
   */
  @Get(':runId')
  getOne(@Param('runId') runId: string) {
    return this.observability.getRun(runId);
  }
}
