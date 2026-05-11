import { Module } from '@nestjs/common';
import { ClassGroupsController } from './class-groups.controller';
import { ClassGroupsService } from './class-groups.service';

@Module({
  controllers: [ClassGroupsController],
  providers: [ClassGroupsService],
})
export class ClassGroupsModule {}
