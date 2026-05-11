import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import {
  canTakeAttendance,
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
  isGlobalUser,
  isInstitutionAdmin,
  isSuperAdmin,
  isViewer,
} from '../common/permissions/permissions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { assertDateString } from '../common/utils/report.helpers';
import { PrismaService } from '../prisma/prisma.service';
import { BulkSaveAttendanceDto } from './dto/bulk-save-attendance.dto';
import { GetAttendanceQueryDto } from './dto/get-attendance-query.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, query: GetAttendanceQueryDto) {
    const institutionId = this.resolveRequiredInstitutionId(user, query.institutionId);
    await this.ensureClassScope(user, query.classGroupId ? [query.classGroupId] : []);
    if (query.date) assertDateString(query.date);
    if (query.startDate) assertDateString(query.startDate, 'startDate');
    if (query.endDate) assertDateString(query.endDate, 'endDate');

    const where = await this.buildAttendanceWhere(user, institutionId, query);

    return this.prisma.attendance.findMany({
      where,
      select: attendanceSelect,
      orderBy: [{ date: 'asc' }, { student: { fullName: 'asc' } }],
    });
  }

  async findByDatePrayer(user: AuthenticatedUser, query: GetAttendanceQueryDto) {
    if (!query.date || !query.prayerTypeId) {
      throw new BadRequestException('date and prayerTypeId are required');
    }
    const institutionId = this.resolveRequiredInstitutionId(user, query.institutionId);
    await this.ensureClassScope(user, query.classGroupId ? [query.classGroupId] : []);
    assertDateString(query.date);

    await this.ensurePrayerTypeInInstitution(query.prayerTypeId, institutionId);
    const classGroupIds = query.classGroupId ? [query.classGroupId] : [];
    const students = await this.findScopedStudents(user, institutionId, classGroupIds, false);
    const studentIds = students.map((student) => student.id);

    const records = await this.prisma.attendance.findMany({
      where: {
        institutionId,
        date: query.date,
        prayerTypeId: query.prayerTypeId,
        studentId: { in: studentIds },
      },
      select: {
        studentId: true,
        status: true,
      },
    });
    const statusByStudent = new Map(records.map((record) => [record.studentId, record.status]));

    return {
      date: query.date,
      prayerTypeId: query.prayerTypeId,
      records: students.map((student) => ({
        studentId: student.id,
        studentName: student.fullName,
        classGroupId: student.classGroupId,
        classGroupName: student.classGroup.name,
        status: statusByStudent.get(student.id) ?? null,
      })),
    };
  }

  async bulkSave(user: AuthenticatedUser, dto: BulkSaveAttendanceDto) {
    if (!canTakeAttendance(user) || isGlobalManager(user) || isViewer(user)) {
      throw new ForbiddenException('You cannot save attendance');
    }
    this.ensureCanWriteAttendance(user, dto.institutionId);
    assertDateString(dto.date);

    await this.ensureActiveInstitution(dto.institutionId);
    await this.ensurePrayerTypeInInstitution(dto.prayerTypeId, dto.institutionId);

    const uniqueStudentIds = [...new Set(dto.records.map((record) => record.studentId))];
    const students = await this.prisma.student.findMany({
      where: {
        id: { in: uniqueStudentIds },
        institutionId: dto.institutionId,
        isActive: true,
      },
      include: { classGroup: true },
    });
    if (students.length !== uniqueStudentIds.length) {
      throw new ForbiddenException('All students must be active and belong to the institution');
    }
    await this.ensureClassScope(user, students.map((student) => student.classGroupId));

    const existing = await this.prisma.attendance.findMany({
      where: {
        institutionId: dto.institutionId,
        prayerTypeId: dto.prayerTypeId,
        date: dto.date,
        studentId: { in: uniqueStudentIds },
      },
      select: { studentId: true },
    });
    const existingStudentIds = new Set(existing.map((record) => record.studentId));

    await this.prisma.$transaction(
      dto.records.map((record) =>
        this.prisma.attendance.upsert({
          where: {
            institutionId_studentId_prayerTypeId_date: {
              institutionId: dto.institutionId,
              studentId: record.studentId,
              prayerTypeId: dto.prayerTypeId,
              date: dto.date,
            },
          },
          create: {
            institutionId: dto.institutionId,
            studentId: record.studentId,
            prayerTypeId: dto.prayerTypeId,
            date: dto.date,
            status: record.status,
            createdByUserId: user.id,
          },
          update: {
            status: record.status,
          },
        }),
      ),
    );

    const updatedCount = dto.records.filter((record) =>
      existingStudentIds.has(record.studentId),
    ).length;
    const createdCount = dto.records.length - updatedCount;

    return {
      savedCount: dto.records.length,
      createdCount,
      updatedCount,
    };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateAttendanceDto) {
    if (!canTakeAttendance(user) || isGlobalManager(user) || isViewer(user)) {
      throw new ForbiddenException('You cannot update attendance');
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!attendance) throw new NotFoundException('Attendance not found');

    this.ensureCanWriteAttendance(user, attendance.institutionId);
    await this.ensureClassScope(user, [attendance.student.classGroupId]);

    return this.prisma.attendance.update({
      where: { id },
      data: { status: dto.status },
      select: attendanceSelect,
    });
  }

  private resolveRequiredInstitutionId(
    user: AuthenticatedUser,
    requestedInstitutionId?: string,
  ) {
    if (isGlobalUser(user) && !requestedInstitutionId) {
      throw new BadRequestException('institutionId is required');
    }
    const institutionId = getScopedInstitutionIdOrThrow(user, requestedInstitutionId);
    if (!institutionId) throw new BadRequestException('institutionId is required');
    return institutionId;
  }

  private async buildAttendanceWhere(
    user: AuthenticatedUser,
    institutionId: string,
    query: GetAttendanceQueryDto,
  ): Promise<Prisma.AttendanceWhereInput> {
    const where: Prisma.AttendanceWhereInput = { institutionId };

    if (query.date) where.date = query.date;
    if (query.startDate || query.endDate) {
      where.date = {
        gte: query.startDate,
        lte: query.endDate,
      };
    }
    if (query.prayerTypeId) where.prayerTypeId = query.prayerTypeId;
    if (query.studentId) where.studentId = query.studentId;

    const studentWhere: Prisma.StudentWhereInput = {
      institutionId,
      ...(query.includeInactiveStudents ? {} : { isActive: true }),
    };
    if (query.classGroupId) studentWhere.classGroupId = query.classGroupId;
    if ((user.institutionRole === 'RECORDER' || user.institutionRole === 'VIEWER') && user.assignedClassGroupIds.length > 0) {
      studentWhere.classGroupId = { in: user.assignedClassGroupIds };
    }
    where.student = studentWhere;

    if (!query.includeInactivePrayerTypes) {
      where.prayerType = { isActive: true };
    }

    return where;
  }

  private async findScopedStudents(
    user: AuthenticatedUser,
    institutionId: string,
    classGroupIds: string[],
    includeInactive: boolean,
  ) {
    const where: Prisma.StudentWhereInput = {
      institutionId,
      ...(includeInactive ? {} : { isActive: true }),
    };
    if (classGroupIds.length > 0) where.classGroupId = { in: classGroupIds };
    if ((user.institutionRole === 'RECORDER' || user.institutionRole === 'VIEWER') && user.assignedClassGroupIds.length > 0) {
      where.classGroupId = { in: user.assignedClassGroupIds };
      if (classGroupIds.length > 0) {
        where.classGroupId = {
          in: classGroupIds.filter((id) => user.assignedClassGroupIds.includes(id)),
        };
      }
    }
    return this.prisma.student.findMany({
      where,
      include: { classGroup: true },
      orderBy: { fullName: 'asc' },
    });
  }

  private async ensureActiveInstitution(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { isActive: true },
    });
    if (!institution || !institution.isActive) {
      throw new NotFoundException('Institution not found');
    }
  }

  private async ensurePrayerTypeInInstitution(prayerTypeId: string, institutionId: string) {
    const prayerType = await this.prisma.prayerType.findUnique({
      where: { id: prayerTypeId },
      select: { institutionId: true, isActive: true },
    });
    if (!prayerType || !prayerType.isActive || prayerType.institutionId !== institutionId) {
      throw new ForbiddenException('Prayer type must belong to the institution');
    }
  }

  private async ensureClassScope(user: AuthenticatedUser, classGroupIds: string[]) {
    if (
      (user.institutionRole === 'RECORDER' || user.institutionRole === 'VIEWER') &&
      user.assignedClassGroupIds.length > 0
    ) {
      const allowed = new Set(user.assignedClassGroupIds);
      const outsideScope = classGroupIds.some((classGroupId) => !allowed.has(classGroupId));
      if (outsideScope) {
        throw new ForbiddenException('Class group is outside user scope');
      }
    }
  }

  private ensureCanWriteAttendance(user: AuthenticatedUser, institutionId: string) {
    if (isSuperAdmin(user)) return;
    if (
      (isInstitutionAdmin(user) || user.institutionRole === 'RECORDER') &&
      user.institutionId === institutionId
    ) {
      return;
    }
    throw new ForbiddenException('You cannot write attendance for this institution');
  }
}

const attendanceSelect = {
  id: true,
  institutionId: true,
  studentId: true,
  prayerTypeId: true,
  date: true,
  status: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  student: {
    select: {
      id: true,
      fullName: true,
      classGroupId: true,
      classGroup: {
        select: { id: true, name: true, teacherName: true },
      },
    },
  },
  prayerType: {
    select: { id: true, name: true, sortOrder: true },
  },
} satisfies Prisma.AttendanceSelect;
