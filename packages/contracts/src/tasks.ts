import { z } from 'zod';
import { id, isoDate, longText, type Ref } from './common.js';
import { OPERATION_TYPES, type OperationStatus } from './operations.js';

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TaskInput = z.object({
  farmId: id,
  fieldId: id.nullish(),
  title: z.string().trim().min(1).max(200),
  description: longText,
  assigneeEmployeeId: id.nullish(),
  dueOn: isoDate.nullish(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  status: z.enum(TASK_STATUSES).default('open'),
});
export type TaskInput = z.input<typeof TaskInput>;

export const UpdateTaskInput = TaskInput.partial();
export type UpdateTaskInput = z.input<typeof UpdateTaskInput>;

/** Turn a task into a planned field operation, so the work is recorded without re-entry. */
export const PlanTaskOperationInput = z.object({ type: z.enum(OPERATION_TYPES) });
export type PlanTaskOperationInput = z.input<typeof PlanTaskOperationInput>;

export interface Task {
  id: string;
  farmId: string;
  farmName: string;
  field: Ref | null;
  operation: { id: string; title: string; status: OperationStatus } | null;
  title: string;
  description: string | null;
  assignee: Ref | null;
  dueOn: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  overdue: boolean;
  completedAt: string | null;
  createdAt: string;
}

export const TaskListQuery = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'canceled', 'active']).optional(),
  farmId: id.optional(),
  fieldId: id.optional(),
  assigneeEmployeeId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type TaskListQuery = z.input<typeof TaskListQuery>;
