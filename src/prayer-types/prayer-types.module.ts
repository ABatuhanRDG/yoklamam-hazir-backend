import { Module } from '@nestjs/common';
import { PrayerTypesController } from './prayer-types.controller';
import { PrayerTypesService } from './prayer-types.service';

@Module({
  controllers: [PrayerTypesController],
  providers: [PrayerTypesService],
})
export class PrayerTypesModule {}
