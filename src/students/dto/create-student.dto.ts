import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateStudentDto {
  @IsUUID()
  institutionId: string;

  @IsUUID()
  classGroupId: string;

  @IsString()
  @MinLength(2)
  fullName: string;
}
