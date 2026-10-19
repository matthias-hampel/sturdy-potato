import { z } from 'zod';
import type { ProductCategory } from './inventory.js';
import type { TaskStatus } from './tasks.js';
import type { EquipmentKind } from './team.js';

export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type SearchQuery = z.input<typeof SearchQuery>;

/** One hit of the global search; `detail` is a secondary line (farm, job title, manufacturer …). */
interface Hit {
  id: string;
  title: string;
  detail: string | null;
}

/** Global search across the organization, one capped list per kind. */
export interface SearchResults {
  fields: (Hit & { identifier: string | null })[];
  employees: (Hit & { active: boolean })[];
  products: (Hit & { category: ProductCategory })[];
  equipment: (Hit & { kind: EquipmentKind })[];
  tasks: (Hit & { status: TaskStatus; dueOn: string | null })[];
}
