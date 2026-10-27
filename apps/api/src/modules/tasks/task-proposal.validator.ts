import { HttpException, HttpStatus } from '@nestjs/common';
import { TASK_ERROR_CODES } from './tasks.constants';
import { Task, TaskProposal, TaskStatus, ProposalStatus } from './tasks.types';
import type { JwtPayload } from '../platform/types/identity.types';

export class TaskProposalValidator {
  static assertCanPropose(task: Task, user: JwtPayload): void {
    if (user.role !== 'EMPLOYEE' || task.assigneeId !== user.sub) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_NOT_ASSIGNEE, message: 'Chỉ nhân viên phụ trách task mới có quyền gửi đề xuất.' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (task.status === TaskStatus.done || task.status === TaskStatus.cancelled) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_LOCKED, message: 'Task đã bị khóa, không thể gửi đề xuất.' },
        HttpStatus.CONFLICT,
      );
    }
    if (task.hasPendingProposal) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_PROPOSAL_PENDING, message: 'Task đã có đề xuất đang chờ xử lý.' },
        HttpStatus.CONFLICT,
      );
    }
  }

  static assertManagerOrAdmin(user: JwtPayload): void {
    if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_NOT_ASSIGNEE, message: 'Chỉ Quản lý hoặc Admin mới có quyền thực hiện.' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  static assertProposalPending(proposal: TaskProposal | null, taskId: string): asserts proposal is TaskProposal {
    if (!proposal || proposal.taskId !== taskId) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.PROPOSAL_NOT_FOUND, message: 'Đề xuất không tồn tại hoặc không thuộc task.' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.PROPOSAL_ALREADY_REVIEWED, message: 'Đề xuất đã được xử lý trước đó.' },
        HttpStatus.CONFLICT,
      );
    }
  }

  static assertTaskNotLocked(task: Task): void {
    if (task.status === TaskStatus.done || task.status === TaskStatus.cancelled) {
      throw new HttpException(
        { errorCode: TASK_ERROR_CODES.TSK_LOCKED, message: 'Task đã bị khóa, không thể duyệt đề xuất.' },
        HttpStatus.CONFLICT,
      );
    }
  }
}
