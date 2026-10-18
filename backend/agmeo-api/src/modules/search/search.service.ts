import { Injectable } from '@nestjs/common';
import type { EquipmentKind, ProductCategory, SearchQuery, SearchResults, TaskStatus } from '@agmeo/contracts';
import { type SqlBool, sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import type { Out } from '../../core/validation.js';
import { Database } from '../../db/database.js';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/**
 * Every whitespace-separated term must appear in at least one of the columns, so
 * "weizen nord" finds a field "Nordschlag" with a wheat note as well as "Weizen Nord".
 */
const matches = (terms: string[], columns: string[]) =>
  sql<SqlBool>`${sql.join(
    terms.map((term) => sql`(${sql.join(columns.map((c) => sql`${sql.ref(c)} ILIKE ${`%${escapeLike(term)}%`}`), sql` OR `)})`),
    sql` AND `,
  )}`;

/** Titles starting with the query first, then titles containing it, then hits only in other columns (farm, notes …). */
const rank = (column: string, q: string) =>
  sql<number>`CASE WHEN ${sql.ref(column)} ILIKE ${`${escapeLike(q)}%`} THEN 0 WHEN ${sql.ref(column)} ILIKE ${`%${escapeLike(q)}%`} THEN 1 ELSE 2 END`;

@Injectable()
export class SearchService {
  constructor(private readonly db: Database) {}

  search(ctx: Ctx, query: Out<typeof SearchQuery>): Promise<SearchResults> {
    const q = query.q;
    const terms = q.split(/\s+/).filter(Boolean);
    const limit = query.limit;
    return this.db.run(ctx, async (trx) => {
      const [fields, employees, products, equipment, tasks] = await Promise.all([
        trx
          .selectFrom('fields as f')
          .innerJoin('farms as fa', 'fa.id', 'f.farm_id')
          .select(['f.id', 'f.name', 'f.identifier', 'fa.name as farm_name'])
          .where('f.status', '=', 'active')
          .where(matches(terms, ['f.name', 'f.identifier', 'f.notes', 'fa.name']))
          .orderBy(rank('f.name', q))
          .orderBy('f.name')
          .limit(limit)
          .execute(),
        trx
          .selectFrom('employees as e')
          .select(['e.id', 'e.name', 'e.job_title', 'e.active'])
          .where(matches(terms, ['e.name', 'e.job_title', 'e.email', 'e.phone']))
          .orderBy('e.active', 'desc')
          .orderBy(rank('e.name', q))
          .orderBy('e.name')
          .limit(limit)
          .execute(),
        trx
          .selectFrom('products as p')
          .select(['p.id', 'p.name', 'p.manufacturer', 'p.category'])
          .where('p.archived_at', 'is', null)
          .where(matches(terms, ['p.name', 'p.manufacturer', 'p.registration_number', 'p.active_ingredients']))
          .orderBy(rank('p.name', q))
          .orderBy('p.name')
          .limit(limit)
          .execute(),
        trx
          .selectFrom('equipment as m')
          .select(['m.id', 'm.name', 'm.manufacturer', 'm.model', 'm.kind'])
          .where(matches(terms, ['m.name', 'm.manufacturer', 'm.model', 'm.registration']))
          .orderBy(sql`m.status = 'retired'`)
          .orderBy(rank('m.name', q))
          .orderBy('m.name')
          .limit(limit)
          .execute(),
        trx
          .selectFrom('tasks as t')
          .innerJoin('farms as fa', 'fa.id', 't.farm_id')
          .leftJoin('fields as f', 'f.id', 't.field_id')
          .select(['t.id', 't.title', 't.status', 't.due_on', 'f.name as field_name', 'fa.name as farm_name'])
          .where(matches(terms, ['t.title', 't.description', 'f.name']))
          .orderBy(sql`t.status IN ('done', 'canceled')`)
          .orderBy(rank('t.title', q))
          .orderBy('t.due_on', (ob) => ob.asc().nullsLast())
          .limit(limit)
          .execute(),
      ]);
      return {
        fields: fields.map((r) => ({ id: r.id, title: r.name, identifier: r.identifier, detail: r.farm_name })),
        employees: employees.map((r) => ({ id: r.id, title: r.name, detail: r.job_title, active: r.active })),
        products: products.map((r) => ({ id: r.id, title: r.name, detail: r.manufacturer, category: r.category as ProductCategory })),
        equipment: equipment.map((r) => ({
          id: r.id,
          title: r.name,
          detail: [r.manufacturer, r.model].filter(Boolean).join(' ') || null,
          kind: r.kind as EquipmentKind,
        })),
        tasks: tasks.map((r) => ({ id: r.id, title: r.title, detail: r.field_name ?? r.farm_name, status: r.status as TaskStatus, dueOn: r.due_on })),
      };
    });
  }
}
