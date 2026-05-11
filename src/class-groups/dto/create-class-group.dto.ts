import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateClassGroupDto {
  @IsUUID()
  institutionId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  teacherName: string;
}
