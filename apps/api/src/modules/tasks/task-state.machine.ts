import { HttpException, HttpStatus } from '@nestjs/common';
import { TaskStatus } from './tasks.types';
import { TASK_ERROR_CODES } from './tasks.constants';
import type { UserRole } from '../platform/types/identity.types';

export class TaskStateMachine {
  static validate(
    task: {
      status: TaskStatus;
      previousStatus?: TaskStatus | null;
      deadline: Date;
      assigneeId: string;
    },
    toStatus: TaskStatus,
    actor: { id: string; role: UserRole },
    reason?: string,
    newDeadline?: string,
  ): void {
    this.assertNotLocked(task.status);
    this.assertValidPath(task.status, toStatus, task.previousStatus);
    this.assertAuthorized(task.status, toStatus, actor, task.assigneeId);
    this.assertReasonProvided(toStatus, reason);
    this.assertDeadlineValid(task.status, toStatus, task.deadline, newDeadline);
  }

  private static assertNotLocked(currentStatus: TaskStatus): void {
    if (currentStatus === TaskStatus.done || currentStatus === TaskStatus.cancelled) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.TSK_LOCKED,
          message: 'Task đã bị khóa (hoàn thành hoặc đã hủy), không thể thay đổi trạng thái.',
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  private static assertValidPath(
    from: TaskStatus,
    to: TaskStatus,
    previousStatus?: TaskStatus | null,
  ): void {
    if (
      from === TaskStatus.todo &&
      (to === TaskStatus.in_progress || to === TaskStatus.postponed || to === TaskStatus.cancelled)
    ) {
      return;
    }
    if (
      from === TaskStatus.in_progress &&
      (to === TaskStatus.in_review || to === TaskStatus.postponed || to === TaskStatus.cancelled)
    ) {
      return;
    }
    if (
      from === TaskStatus.in_review &&
      (to === TaskStatus.done || to === TaskStatus.rework)
    ) {
      return;
    }
    if (
      from === TaskStatus.postponed &&
      (to === TaskStatus.cancelled || to === TaskStatus.in_progress || (Boolean(previousStatus) && to === previousStatus))
    ) {
      return;
    }

    throw new HttpException(
      {
        errorCode: TASK_ERROR_CODES.TSK_INVALID_TRANSITION,
        message: `Chuyển đổi trạng thái từ ${from} sang ${to} không hợp lệ.`,
      },
      HttpStatus.CONFLICT,
    );
  }

  private static assertAuthorized(
    from: TaskStatus,
    to: TaskStatus,
    actor: { id: string; role: UserRole },
    assigneeId: string,
  ): void {
    const isManagerOrAdmin = actor.role === 'MANAGER' || actor.role === 'ADMIN';

    // TR-04, TR-05, TR-06, TR-08: Chỉ Quản lý / Admin
    const isManagerAction =
      to === TaskStatus.done ||
      to === TaskStatus.rework ||
      to === TaskStatus.postponed ||
      to === TaskStatus.cancelled;

    if (isManagerAction && !isManagerOrAdmin) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.TSK_NOT_ASSIGNEE,
          message: 'Chỉ Quản lý hoặc Admin mới có quyền thực hiện thao tác này.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // TR-02, TR-03, TR-07: Nhân viên phụ trách
    const isAssigneeAction =
      to === TaskStatus.in_progress ||
      to === TaskStatus.in_review ||
      (from === TaskStatus.postponed && to !== TaskStatus.cancelled);

    if (isAssigneeAction && actor.role === 'EMPLOYEE' && actor.id !== assigneeId) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.TSK_NOT_ASSIGNEE,
          message: 'Chỉ nhân viên phụ trách mới có quyền thực hiện thao tác này.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private static assertReasonProvided(to: TaskStatus, reason?: string): void {
    const requiresReason =
      to === TaskStatus.rework ||
      to === TaskStatus.postponed ||
      to === TaskStatus.cancelled;

    if (!requiresReason) {
      return;
    }

    if (!reason || reason.trim().length === 0) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.REASON_REQUIRED,
          message: 'Bắt buộc phải cung cấp lý do cho thao tác này.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private static assertDeadlineValid(
    from: TaskStatus,
    to: TaskStatus,
    currentDeadline: Date,
    newDeadline?: string,
  ): void {
    const now = new Date();
    const isPastDeadline = new Date(currentDeadline).getTime() < now.getTime();

    const mustProvideDeadline =
      (to === TaskStatus.rework && isPastDeadline) ||
      (from === TaskStatus.postponed && to !== TaskStatus.cancelled && isPastDeadline);

    if (mustProvideDeadline && !newDeadline) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.TSK_DEADLINE_REQUIRED,
          message: 'Deadline đã quá hạn, bắt buộc phải cung cấp newDeadline ở tương lai.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (newDeadline && new Date(newDeadline).getTime() <= now.getTime()) {
      throw new HttpException(
        {
          errorCode: TASK_ERROR_CODES.TSK_DEADLINE_REQUIRED,
          message: 'newDeadline phải là thời điểm trong tương lai.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  static computeTransitionUpdates(
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    newDeadline?: string,
  ): {
    status: TaskStatus;
    progress?: number;
    previousStatus?: TaskStatus;
    deadline?: Date;
  } {
    const data: {
      status: TaskStatus;
      progress?: number;
      previousStatus?: TaskStatus;
      deadline?: Date;
    } = { status: toStatus };

    if (toStatus === TaskStatus.done) {
      data.progress = 100;
    }

    if (toStatus === TaskStatus.postponed) {
      data.previousStatus = fromStatus;
    }

    if (newDeadline) {
      data.deadline = new Date(newDeadline);
    }

    return data;
  }
}
