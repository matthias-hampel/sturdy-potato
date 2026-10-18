import { Inject, Injectable, Module, type OnApplicationShutdown, Global } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './schema.js';

// numeric → number (aggregations stay in SQL; values are display precision in JS),
// bigint counts → number, date → 'YYYY-MM-DD' string (no timezone shifting).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Trx = Transaction<DB>;
export const KYSELY = Symbol('KYSELY');

export function createKysely(connectionString: string, max = 10): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}

export interface TenantScope {
  userId: string;
  orgId?: string | null;
}

@Injectable()
export class Database implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) readonly kysely: Kysely<DB>) {}

  /**
   * Runs `fn` in a transaction whose row-level-security context is the given user and,
   * optionally, organization. Every tenant query must go through here.
   */
  run<T>(scope: TenantScope, fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.kysely.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${scope.userId}, true),
                       set_config('app.organization_id', ${scope.orgId ?? ''}, true)`.execute(trx);
      return fn(trx);
    });
  }

  async onApplicationShutdown() {
    await this.kysely.destroy();
  }
}

@Global()
@Module({
  providers: [{ provide: KYSELY, useFactory: () => createKysely(config.databaseUrl) }, Database],
  exports: [Database],
})
export class DatabaseModule {}
