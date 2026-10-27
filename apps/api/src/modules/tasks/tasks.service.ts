import { Injectable, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database';
import { CreateTaskDto, UpdateTaskStatusDto, CreateTaskProposalDto, RejectTaskProposalDto } from './dto';
import { TaskStateMachine } from './task-state.machine';
import { TaskStatus } from './tasks.types';
import { TASK_ERROR_CODES, TASK_EVENT_STATUS_CHANGED } from './tasks.constants';
import { TaskProposalsService } from './task-proposals.service';
import type {
  Task,
  TaskHistory,
  TaskStatusTransitionPayload,
  TaskProposalResponse,
  TaskProposalReviewResponse,
} from './tasks.types';
import type { JwtPayload, UserRole } from '../platform/types/identity.types';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly taskProposalsService: TaskProposalsService,
  ) {}

  async create(createdById: string, dto: CreateTaskDto): Promise<Task> {
    const deadlineDate = new Date(dto.deadline);
    if (deadlineDate <= new Date()) {
      throw new BadRequestException('Deadline phải là thời điểm trong tương lai.');
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        deadline: deadlineDate,
        assigneeId: dto.assigneeId,
        creatorId: createdById,
        status: TaskStatus.todo,
      },
    });

    this.logger.log(`Task created: ${task.id} by ${createdById}`);
    this.eventEmitter.emit('task.created', {
      taskId: task.id,
      taskTitle: task.title,
      assigneeId: task.assigneeId,
      assignedById: createdById,
      deadline: task.deadline,
    });

    return task;
  }

  async transitionStatus(
    taskId: string,
    actor: JwtPayload,
    dto: UpdateTaskStatusDto,
  ): Promise<{ task: Task; history: TaskHistory }> {
    const task = await this.findTaskOrThrow(taskId);

    TaskStateMachine.validate(
      task,
      dto.toStatus,
      { id: actor.sub, role: actor.role },
      dto.reason,
      dto.newDeadline,
    );

    const updates = TaskStateMachine.computeTransitionUpdates(
      task.status,
      dto.toStatus,
      dto.newDeadline,
    );

    const result = await this.executeTransitionTransaction(task, actor.sub, updates, dto);
    this.emitStatusChangedEvent(result.task, task.status, actor.sub, dto.reason);

    this.logger.log(`Task ${taskId} transitioned: ${task.status} -> ${dto.toStatus} by ${actor.sub}`);
    return result;
  }

  async updateStatus(
    taskId: string,
    newStatus: TaskStatus,
    userId: string,
    role: UserRole,
    reason?: string,
  ): Promise<Task> {
    const result = await this.transitionStatus(
      taskId,
      { sub: userId, role, email: '' },
      { toStatus: newStatus, reason },
    );
    return result.task;
  }

  async findAll(query?: { assigneeId?: string; status?: TaskStatus }): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        ...(query?.assigneeId && { assigneeId: query.assigneeId }),
        ...(query?.status && { status: query.status }),
      },
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { deadline: 'asc' },
    });
  }

  async findById(taskId: string): Promise<Task> {
    return this.findTaskOrThrow(taskId);
  }

  async createProposal(
    taskId: string,
    user: JwtPayload,
    dto: CreateTaskProposalDto,
  ): Promise<TaskProposalResponse> {
    return this.taskProposalsService.create(taskId, user, dto);
  }

  async approveProposal(
    taskId: string,
    proposalId: string,
    user: JwtPayload,
  ): Promise<TaskProposalReviewResponse> {
    return this.taskProposalsService.approve(taskId, proposalId, user);
  }

  async rejectProposal(
    taskId: string,
    proposalId: string,
    user: JwtPayload,
    dto: RejectTaskProposalDto,
  ): Promise<TaskProposalReviewResponse> {
    return this.taskProposalsService.reject(taskId, proposalId, user, dto);
  }

  private async findTaskOrThrow(taskId: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_NOT_FOUND, message: 'Task không tồn tại.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return task;
  }

  private async executeTransitionTransaction(
    currentTask: Task,
    actorId: string,
    updates: { status: TaskStatus; progress?: number; previousStatus?: TaskStatus; deadline?: Date },
    dto: UpdateTaskStatusDto,
  ): Promise<{ task: Task; history: TaskHistory }> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({ where: { id: currentTask.id }, data: updates });
      const history = await tx.taskHistory.create({
        data: {
          taskId: currentTask.id,
          actorId,
          type: 'STATUS_CHANGE',
          oldValue: currentTask.status,
          newValue: dto.toStatus,
          reason: dto.reason ?? null,
        },
      });
      return { task, history };
    });
  }

  private emitStatusChangedEvent(
    updatedTask: Task,
    fromStatus: TaskStatus,
    actorId: string,
    reason?: string,
  ): void {
    const payload: TaskStatusTransitionPayload = {
      taskId: updatedTask.id,
      fromStatus,
      toStatus: updatedTask.status,
      actorId,
      reason,
      newDeadline: updatedTask.deadline,
      previousStatus: updatedTask.previousStatus,
      progress: updatedTask.progress,
    };
    this.eventEmitter.emit(TASK_EVENT_STATUS_CHANGED, payload);
  }
}
