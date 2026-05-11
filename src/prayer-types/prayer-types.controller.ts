import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreatePrayerTypeDto } from './dto/create-prayer-type.dto';
import { ReorderPrayerTypesDto } from './dto/reorder-prayer-types.dto';
import { UpdatePrayerTypeDto } from './dto/update-prayer-type.dto';
import { PrayerTypesService } from './prayer-types.service';

@UseGuards(JwtAuthGuard)
@Controller('prayer-types')
export class PrayerTypesController {
  constructor(private readonly prayerTypesService: PrayerTypesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { institutionId?: string; includeInactive?: string },
  ) {
    return this.prayerTypesService.findAll(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePrayerTypeDto) {
    return this.prayerTypesService.create(user, dto);
  }

  @Post('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderPrayerTypesDto,
  ) {
    return this.prayerTypesService.reorder(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrayerTypeDto,
  ) {
    return this.prayerTypesService.update(user, id, dto);
  }

  @Delete(':id')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.prayerTypesService.deactivate(user, id);
  }
}
