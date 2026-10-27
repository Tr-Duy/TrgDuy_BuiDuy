import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database';
import {
  TASK_ERROR_CODES,
  TASK_EVENT_PROPOSAL_CREATED,
  TASK_EVENT_PROPOSAL_APPROVED,
  TASK_EVENT_PROPOSAL_REJECTED,
  TASK_EVENT_STATUS_CHANGED,
} from './tasks.constants';
import {
  Task,
  TaskProposal,
  TaskStatus,
  ProposalType,
  ProposalStatus,
  TaskProposalResponse,
  TaskProposalReviewResponse,
} from './tasks.types';
import { CreateTaskProposalDto } from './dto/create-task-proposal.dto';
import { RejectTaskProposalDto } from './dto/reject-task-proposal.dto';
import { TaskProposalValidator } from './task-proposal.validator';
import type { JwtPayload } from '../platform/types/identity.types';

@Injectable()
export class TaskProposalsService {
  private readonly logger = new Logger(TaskProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(taskId: string, user: JwtPayload, dto: CreateTaskProposalDto): Promise<TaskProposalResponse> {
    const task = await this.findTaskOrThrow(taskId);
    TaskProposalValidator.assertCanPropose(task, user);

    const proposal = await this.executeCreateTx(task.id, user.sub, dto);
    this.logger.log(`Proposal ${proposal.id} created for task ${taskId} by ${user.sub}`);

    this.eventEmitter.emit(TASK_EVENT_PROPOSAL_CREATED, {
      proposalId: proposal.id,
      taskId: task.id,
      userId: user.sub,
      type: proposal.type,
      reason: proposal.reason,
    });

    return { proposal };
  }

  async approve(taskId: string, proposalId: string, user: JwtPayload): Promise<TaskProposalReviewResponse> {
    TaskProposalValidator.assertManagerOrAdmin(user);
    const proposal = await this.prisma.taskProposal.findUnique({ where: { id: proposalId } });
    TaskProposalValidator.assertProposalPending(proposal, taskId);

    const task = await this.findTaskOrThrow(taskId);
    TaskProposalValidator.assertTaskNotLocked(task);

    const result = await this.executeApproveTx(task, proposal, user.sub);
    this.emitApprovedEvents(result.updatedProposal, result.updatedTask, user.sub, proposal.reason, task.status);
    this.logger.log(`Proposal ${proposalId} approved for task ${taskId} by ${user.sub}`);

    return { proposal: result.updatedProposal, task: result.updatedTask };
  }

  async reject(
    taskId: string,
    proposalId: string,
    user: JwtPayload,
    dto: RejectTaskProposalDto,
  ): Promise<TaskProposalReviewResponse> {
    TaskProposalValidator.assertManagerOrAdmin(user);
    const proposal = await this.prisma.taskProposal.findUnique({ where: { id: proposalId } });
    TaskProposalValidator.assertProposalPending(proposal, taskId);

    const task = await this.findTaskOrThrow(taskId);
    const result = await this.executeRejectTx(task.id, proposal.id, user.sub, dto.reason);

    this.eventEmitter.emit(TASK_EVENT_PROPOSAL_REJECTED, {
      proposalId: result.updatedProposal.id,
      taskId: task.id,
      type: result.updatedProposal.type,
      reviewerId: user.sub,
      reviewReason: dto.reason,
    });
    this.logger.log(`Proposal ${proposalId} rejected for task ${taskId} by ${user.sub}`);

    return { proposal: result.updatedProposal, task: result.updatedTask };
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

  private async executeCreateTx(taskId: string, userId: string, dto: CreateTaskProposalDto): Promise<TaskProposal> {
    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.taskProposal.create({
        data: {
          taskId,
          userId,
          type: dto.type,
          status: ProposalStatus.PENDING,
          reason: dto.reason,
        },
      });
      await tx.task.update({
        where: { id: taskId },
        data: { hasPendingProposal: true },
      });
      return proposal;
    });
  }

  private async executeApproveTx(
    task: Task,
    proposal: TaskProposal,
    reviewerId: string,
  ): Promise<{ updatedProposal: TaskProposal; updatedTask: Task }> {
    const isPostpone = proposal.type === ProposalType.postpone;
    const nextStatus = isPostpone ? TaskStatus.postponed : TaskStatus.cancelled;
    const taskData = isPostpone
      ? { hasPendingProposal: false, status: nextStatus, previousStatus: task.status }
      : { hasPendingProposal: false, status: nextStatus };

    return this.prisma.$transaction(async (tx) => {
      const updatedProposal = await tx.taskProposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.APPROVED, reviewerId, reviewedAt: new Date() },
      });
      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: taskData,
      });
      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          actorId: reviewerId,
          type: 'STATUS_CHANGE',
          oldValue: task.status,
          newValue: nextStatus,
          reason: proposal.reason,
        },
      });
      return { updatedProposal, updatedTask };
    });
  }

  private async executeRejectTx(
    taskId: string,
    proposalId: string,
    reviewerId: string,
    reviewReason: string,
  ): Promise<{ updatedProposal: TaskProposal; updatedTask: Task }> {
    return this.prisma.$transaction(async (tx) => {
      const updatedProposal = await tx.taskProposal.update({
        where: { id: proposalId },
        data: { status: ProposalStatus.REJECTED, reviewerId, reviewReason, reviewedAt: new Date() },
      });
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { hasPendingProposal: false },
      });
      await tx.taskHistory.create({
        data: {
          taskId,
          actorId: reviewerId,
          type: 'PROPOSAL_REJECTED',
          oldValue: updatedTask.status,
          newValue: updatedTask.status,
          reason: reviewReason,
        },
      });
      return { updatedProposal, updatedTask };
    });
  }

  private emitApprovedEvents(
    proposal: TaskProposal,
    task: Task,
    reviewerId: string,
    reason: string,
    fromStatus: TaskStatus,
  ): void {
    this.eventEmitter.emit(TASK_EVENT_PROPOSAL_APPROVED, {
      proposalId: proposal.id,
      taskId: task.id,
      type: proposal.type,
      reviewerId,
      taskStatus: task.status,
    });
    this.eventEmitter.emit(TASK_EVENT_STATUS_CHANGED, {
      taskId: task.id,
      fromStatus,
      toStatus: task.status,
      actorId: reviewerId,
      reason,
      previousStatus: task.previousStatus,
      progress: task.progress,
    });
  }
}
