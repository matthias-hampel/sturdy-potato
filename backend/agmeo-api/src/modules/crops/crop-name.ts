import { sql } from 'kysely';

/**
 * A crop's display name for the (German) UI: the German catalogue name where one exists, else the
 * stored name, which is the English catalogue name or what a user called their custom crop.
 * `alias` is the crops table alias in the query, e.g. `cropName('c').as('crop_name')`; pass `string | null` as `T` when crops is outer-joined.
 */
export const cropName = <T extends string | null = string>(alias: string) => sql<T>`coalesce(${sql.ref(`${alias}.name_de`)}, ${sql.ref(`${alias}.name`)})`;
