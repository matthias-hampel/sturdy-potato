import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PlanTaskOperationInput, TaskInput, TaskListQuery, UpdateTaskInput } from '@agmeo/contracts';
import { type Ctx, OrgCtx, Requires } from '../../auth/context.js';
import { type Out, ZBody, ZQuery } from '../../core/validation.js';
import { TasksService } from './tasks.service.js';

@Controller('orgs/:orgId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@OrgCtx() ctx: Ctx, @ZQuery(TaskListQuery) query: Out<typeof TaskListQuery>) {
    return this.tasks.list(ctx, query);
  }

  @Post()
  @Requires('task.write')
  create(@OrgCtx() ctx: Ctx, @ZBody(TaskInput) input: Out<typeof TaskInput>) {
    return this.tasks.create(ctx, input);
  }

  @Patch(':id')
  @Requires('task.write')
  update(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(UpdateTaskInput) input: Out<typeof UpdateTaskInput>) {
    return this.tasks.update(ctx, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Requires('task.write')
  delete(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.delete(ctx, id);
  }

  @Post(':id/operation')
  @Requires('operation.write')
  planOperation(@OrgCtx() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @ZBody(PlanTaskOperationInput) input: Out<typeof PlanTaskOperationInput>) {
    return this.tasks.planOperation(ctx, id, input);
  }
}
