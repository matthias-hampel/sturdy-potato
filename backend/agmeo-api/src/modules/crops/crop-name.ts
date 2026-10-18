import { sql } from 'kysely';

/**
 * A crop's display name for the (German) UI: the German catalogue name where one exists, else the
 * stored name, which is the English catalogue name or what a user called their custom crop.
 * `alias` is the crops table alias in the query, e.g. `cropName('c').as('crop_name')`; pass `string | null` as `T` when crops is outer-joined.
 */
export const cropName = <T extends string | null = string>(alias: string) => sql<T>`coalesce(${sql.ref(`${alias}.name_de`)}, ${sql.ref(`${alias}.name`)})`;

/**
 * A crop's colour as the organization sees it: its own choice (org_crop_colors, filtered to the
 * current organization by row-level security) or the crop's default. `alias` as in `cropName`.
 */
export const cropColor = <T extends string | null = string>(alias: string) =>
  sql<T>`coalesce((SELECT occ.color FROM org_crop_colors occ WHERE occ.crop_id = ${sql.ref(`${alias}.id`)}), ${sql.ref(`${alias}.color`)})`;

