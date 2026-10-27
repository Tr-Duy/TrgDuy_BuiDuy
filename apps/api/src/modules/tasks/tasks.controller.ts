import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import {
  CreateTaskDto,
  UpdateTaskStatusDto,
  CreateTaskProposalDto,
  RejectTaskProposalDto,
} from './dto';
import { JwtAuthGuard } from '../platform/guards/jwt-auth.guard';
import { CurrentUser } from '../platform/decorators/current-user.decorator';
import type { JwtPayload } from '../platform/types/identity.types';
import type {
  Task,
  TaskStatus,
  TaskTransitionResponse,
  TaskProposalResponse,
  TaskProposalReviewResponse,
} from './tasks.types';

@Controller(['tasks', 'api/v1/tasks'])
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTaskDto,
  ): Promise<Task> {
    return this.tasksService.create(user.sub, dto);
  }

  @Get()
  async findAll(
    @Query('assigneeId') assigneeId?: string,
    @Query('status') status?: TaskStatus,
  ): Promise<Task[]> {
    return this.tasksService.findAll({ assigneeId, status });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Task> {
    return this.tasksService.findById(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async transitionStatus(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<TaskTransitionResponse> {
    const result = await this.tasksService.transitionStatus(id, user, dto);
    return {
      statusCode: HttpStatus.OK,
      data: result,
    };
  }

  @Post(':id/proposals')
  @HttpCode(HttpStatus.CREATED)
  async createProposal(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTaskProposalDto,
  ): Promise<TaskProposalResponse> {
    return this.tasksService.createProposal(id, user, dto);
  }

  @Patch(':id/proposals/:proposalId/approve')
  @HttpCode(HttpStatus.OK)
  async approveProposal(
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<TaskProposalReviewResponse> {
    return this.tasksService.approveProposal(id, proposalId, user);
  }

  @Patch(':id/proposals/:proposalId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProposal(
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RejectTaskProposalDto,
  ): Promise<TaskProposalReviewResponse> {
    return this.tasksService.rejectProposal(id, proposalId, user, dto);
  }
}

