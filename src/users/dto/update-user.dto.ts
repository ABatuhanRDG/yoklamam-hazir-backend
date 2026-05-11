import { InstitutionRole } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(InstitutionRole)
  institutionRole?: InstitutionRole;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assignedClassGroupIds?: string[];

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
