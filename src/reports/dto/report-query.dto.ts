import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class ReportQueryDto {
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;

  @IsOptional()
  @IsString()
  prayerTypeIds?: string;

  @IsOptional()
  @IsString()
  classGroupIds?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactiveStudents?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactivePrayerTypes?: boolean;

  @IsOptional()
  @IsIn(['rate', 'name', 'present', 'absent'])
  sortBy?: 'rate' | 'name' | 'present' | 'absent';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
