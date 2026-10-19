import { z } from 'zod';
import { id, isoDate, longText, type Ref } from './common.js';
import { OPERATION_TYPES, TASK_PRIORITIES, type OperationStatus, type TaskPriority } from './operations.js';

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
  commentCount: number;
  createdAt: string;
  updatedAt: string;
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

/** Changes since a point in time, for mobile clients: deleted tasks are listed by id. */
export const TaskSyncQuery = z.object({ since: z.iso.datetime({ offset: true }).optional() });
export type TaskSyncQuery = z.input<typeof TaskSyncQuery>;

export interface TaskSync {
  tasks: Task[];
  deleted: string[];
  /** Pass as `since` next time. */
  serverTime: string;
}

// ---------------------------------------------------------------------------
// Comments on operations and tasks
// ---------------------------------------------------------------------------

export const COMMENT_TARGETS = ['operation', 'task'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export interface Comment {
  id: string;
  entityType: CommentTarget;
  entityId: string;
  authorUserId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** The current user wrote it (and may edit it). */
  mine: boolean;
}

export const CommentQuery = z.object({ entityType: z.enum(COMMENT_TARGETS), entityId: id });
export type CommentQuery = z.input<typeof CommentQuery>;

export const CommentInput = z.object({
  entityType: z.enum(COMMENT_TARGETS),
  entityId: id,
  /** Client-chosen id makes a retried post idempotent. */
  id: id.optional(),
  body: z.string().trim().min(1).max(5000),
});
export type CommentInput = z.input<typeof CommentInput>;

export const UpdateCommentInput = z.object({ body: z.string().trim().min(1).max(5000) });
export type UpdateCommentInput = z.input<typeof UpdateCommentInput>;
