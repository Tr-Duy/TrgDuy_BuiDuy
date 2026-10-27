import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ProposalType } from '../tasks.types';

export class CreateTaskProposalDto {
  @IsNotEmpty({ message: 'Loại đề xuất không được để trống' })
  @IsEnum(ProposalType, { message: 'Loại đề xuất phải là postpone hoặc cancel' })
  type: ProposalType;

  @IsNotEmpty({ message: 'Lý do không được để trống' })
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  reason: string;
}
