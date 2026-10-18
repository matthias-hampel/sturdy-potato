import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { SEND_EMAIL, sendEmailHandler } from '../mail/mail.js';
import { PURGE_OBJECTS } from '../modules/files/files.service.js';
import { createStorageDriver } from '../storage/object-storage.js';
import type { JobHandler } from './runner.js';
import type { Schedule } from './scheduler.js';

export const CLEANUP_JOBS = 'jobs.cleanup';

/** Every job kind the worker runs, and its handler. */
export function jobHandlers(db: Kysely<DB>): Record<string, JobHandler> {
  const storage = createStorageDriver();
  return {
    [SEND_EMAIL]: sendEmailHandler(),
    // Objects of files deleted from the trash; deleting a missing object is not an error.
    [PURGE_OBJECTS]: async (job) => {
      for (const key of (job.payload.keys as string[] | undefined) ?? []) await storage.delete(key);
    },
    // Finished jobs are kept two weeks for inspection, failed ones three months.
    [CLEANUP_JOBS]: async () => {
      await db
        .deleteFrom('jobs')
        .where((eb) =>
          eb.or([
            eb('finished_at', '<', sql<Date>`now() - interval '14 days'`),
            eb('failed_at', '<', sql<Date>`now() - interval '90 days'`),
          ]),
        )
        .execute();
    },
  };
}

/** Recurring jobs. Slots are aligned to UTC; jobs that depend on local time check each organization's time zone themselves. */
export const schedules: Schedule[] = [{ kind: CLEANUP_JOBS, everyMinutes: 24 * 60, offsetMinutes: 3 * 60 }];
