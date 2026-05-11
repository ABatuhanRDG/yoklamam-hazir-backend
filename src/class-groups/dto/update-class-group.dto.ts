import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateClassGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  teacherName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
