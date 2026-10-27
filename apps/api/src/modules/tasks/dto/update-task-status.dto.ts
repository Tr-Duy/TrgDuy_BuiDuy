import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '../tasks.types';

export class UpdateTaskStatusDto {
  @IsNotEmpty({ message: 'toStatus không được để trống' })
  @IsEnum(TaskStatus, { message: 'toStatus không hợp lệ' })
  toStatus: TaskStatus;

  @IsOptional()
  @IsString({ message: 'reason phải là chuỗi ký tự' })
  reason?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'newDeadline phải là định dạng ISO 8601 hợp lệ' })
  newDeadline?: string;
}
