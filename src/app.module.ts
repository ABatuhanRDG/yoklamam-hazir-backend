import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { ClassGroupsModule } from './class-groups/class-groups.module';
import { InstitutionsModule } from './institutions/institutions.module';
import { PrayerTypesModule } from './prayer-types/prayer-types.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { StudentsModule } from './students/students.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    InstitutionsModule,
    ClassGroupsModule,
    StudentsModule,
    PrayerTypesModule,
    AttendanceModule,
    ReportsModule,
  ],
})
export class AppModule {}
