import { InstitutionRole } from '@prisma/client';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateInstitutionUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsUUID()
  institutionId: string;

  @IsEnum(InstitutionRole)
  institutionRole: InstitutionRole;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assignedClassGroupIds?: string[];
}
