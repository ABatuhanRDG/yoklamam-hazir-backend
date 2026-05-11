import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { AttendanceService } from './attendance.service';
import { BulkSaveAttendanceDto } from './dto/bulk-save-attendance.dto';
import { GetAttendanceQueryDto } from './dto/get-attendance-query.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetAttendanceQueryDto,
  ) {
    return this.attendanceService.findAll(user, query);
  }

  @Get('by-date-prayer')
  findByDatePrayer(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetAttendanceQueryDto,
  ) {
    return this.attendanceService.findByDatePrayer(user, query);
  }

  @Post('bulk')
  bulkSave(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkSaveAttendanceDto,
  ) {
    return this.attendanceService.bulkSave(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendanceService.update(user, id, dto);
  }
}
