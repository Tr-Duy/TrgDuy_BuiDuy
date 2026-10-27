import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskProposalsService } from './task-proposals.service';
import { TasksController } from './tasks.controller';
import { TasksGateway } from './tasks.gateway';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TaskProposalsService, TasksGateway],
  exports: [TasksService, TaskProposalsService],
})
export class TasksModule {}

