import { sql } from 'kysely';
import { notFound } from '../../core/errors.js';
import type { Trx } from '../../db/database.js';

export interface SeasonRef {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

/**
 * The season a request refers to: the given one, else the season containing `onDate`
 * (default today), else the most recent season that has started, else the earliest.
 */
export async function resolveSeason(trx: Trx, seasonId?: string | null, onDate?: string | null): Promise<SeasonRef | null> {
  if (seasonId) {
    const season = await trx
      .selectFrom('growing_seasons')
      .select(['id', 'name', 'start_date', 'end_date'])
      .where('id', '=', seasonId)
      .executeTakeFirst();
    if (!season) throw notFound('Season');
    return season;
  }
  const date = onDate ?? null;
  const row = await trx
    .selectFrom('growing_seasons')
    .select(['id', 'name', 'start_date', 'end_date'])
    .orderBy(sql`CASE
        WHEN coalesce(${date}::date, current_date) BETWEEN start_date AND end_date THEN 0
        WHEN start_date <= coalesce(${date}::date, current_date) THEN 1
        ELSE 2 END`)
    .orderBy('start_date', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

/** Name of a season the user did not name. Migration 000013 renamed seasons still carrying the earlier English default. */
export const defaultSeasonName = (harvestYear: number) => `Ernte ${harvestYear}`;
