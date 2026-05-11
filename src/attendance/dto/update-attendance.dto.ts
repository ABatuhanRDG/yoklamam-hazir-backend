import { AttendanceStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateAttendanceDto {
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;
}
