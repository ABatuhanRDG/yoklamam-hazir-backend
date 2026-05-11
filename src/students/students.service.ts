import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyStudentClassGroupScope,
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
  isRecorder,
  isViewer,
  requireInstitutionAccess,
  requireInstitutionManagement,
} from '../common/permissions/permissions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

type ListStudentsQuery = {
  institutionId?: string;
  classGroupId?: string;
  search?: string;
  includeInactive?: string;
};

type StudentDetailQuery = {
  institutionId?: string;
  startDate?: string;
  endDate?: string;
};

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, query: ListStudentsQuery) {
    const institutionId = getScopedInstitutionIdOrThrow(user, query.institutionId);
    const where: Prisma.StudentWhereInput = {};
    if (institutionId) where.institutionId = institutionId;
    if (query.classGroupId) where.classGroupId = query.classGroupId;
    if (query.includeInactive !== 'true') where.isActive = true;
    if (query.search) {
      where.fullName = { contains: query.search.trim(), mode: 'insensitive' };
    }

    return this.prisma.student.findMany({
      where: applyStudentClassGroupScope(user, where),
      include: { classGroup: true },
      orderBy: [{ fullName: 'asc' }],
    });
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { classGroup: true },
    });
    if (!student || !student.isActive) {
      throw new NotFoundException('Student not found');
    }
    this.ensureStudentAccess(user, student);
    return student;
  }

  async attendanceHistory(
    user: AuthenticatedUser,
    id: string,
    query: StudentDetailQuery,
  ) {
    const student = await this.findOne(user, id);
    if (query.institutionId && query.institutionId !== student.institutionId) {
      throw new ForbiddenException('You cannot access another institution');
    }

    const where: Prisma.AttendanceWhereInput = {
      studentId: id,
      institutionId: student.institutionId,
    };
    if (query.startDate || query.endDate) {
      where.date = {
        gte: query.startDate,
        lte: query.endDate,
      };
    }

    return this.prisma.attendance.findMany({
      where,
      select: studentAttendanceSelect,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async analytics(
    user: AuthenticatedUser,
    id: string,
    query: { institutionId?: string },
  ) {
    const student = await this.findOne(user, id);
    if (query.institutionId && query.institutionId !== student.institutionId) {
      throw new ForbiddenException('You cannot access another institution');
    }

    const [studentRecords, institutionStudents, groupStudents] =
      await Promise.all([
        this.prisma.attendance.findMany({
          where: { studentId: id, institutionId: student.institutionId },
          select: { status: true, date: true },
        }),
        this.prisma.student.findMany({
          where: { institutionId: student.institutionId, isActive: true },
          select: { id: true },
        }),
        this.prisma.student.findMany({
          where: { classGroupId: student.classGroupId, isActive: true },
          select: { id: true },
        }),
      ]);

    const institutionRates = await this.calculateRates(
      institutionStudents.map((item) => item.id),
    );
    const groupRates = await this.calculateRates(
      groupStudents.map((item) => item.id),
    );
    const currentRate = this.rateFromRecords(studentRecords);
    const betterOrEqualCount = institutionRates.filter(
      (item) => currentRate >= item.rate,
    ).length;
    const percentile = institutionRates.length
      ? Math.round((betterOrEqualCount / institutionRates.length) * 100)
      : 0;
    const groupRank =
      groupRates
        .sort((a, b) => b.rate - a.rate)
        .findIndex((item) => item.studentId === id) + 1;

    return {
      studentId: id,
      totalSessions: studentRecords.length,
      attendedSessions: studentRecords.filter(
        (record) => record.status === 'PRESENT',
      ).length,
      absentSessions: studentRecords.filter((record) => record.status === 'ABSENT')
        .length,
      attendanceRate: currentRate,
      percentile,
      groupRank: groupRank > 0 ? groupRank : null,
      last7DaysAttendanceRate: this.rateFromRecords(
        this.recordsSince(studentRecords, 7),
      ),
      last30DaysAttendanceRate: this.rateFromRecords(
        this.recordsSince(studentRecords, 30),
      ),
      riskStatus: this.riskStatus(currentRate),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateStudentDto) {
    if (isGlobalManager(user)) {
      throw new ForbiddenException('global_manager cannot create students');
    }
    requireInstitutionManagement(user, dto.institutionId);
    await this.ensureClassGroupInInstitution(dto.classGroupId, dto.institutionId);

    return this.prisma.student.create({
      data: {
        institutionId: dto.institutionId,
        classGroupId: dto.classGroupId,
        fullName: dto.fullName.trim(),
        studentNumber: dto.studentNumber?.trim() || null,
      },
      include: { classGroup: true },
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateStudentDto) {
    const student = await this.findExisting(id);
    requireInstitutionManagement(user, student.institutionId);

    if (dto.classGroupId) {
      await this.ensureClassGroupInInstitution(dto.classGroupId, student.institutionId);
    }

    return this.prisma.student.update({
      where: { id },
      data: {
        fullName: dto.fullName?.trim(),
        classGroupId: dto.classGroupId,
        isActive: dto.isActive,
        studentNumber:
          dto.studentNumber === undefined ? undefined : dto.studentNumber.trim() || null,
      },
      include: { classGroup: true },
    });
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    const student = await this.findExisting(id);
    requireInstitutionManagement(user, student.institutionId);

    return this.prisma.student.update({
      where: { id },
      data: { isActive: false },
      include: { classGroup: true },
    });
  }

  private async findExisting(id: string) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private ensureStudentAccess(
    user: AuthenticatedUser,
    student: { institutionId: string; classGroupId: string },
  ) {
    requireInstitutionAccess(user, student.institutionId);
    if (
      (isRecorder(user) || isViewer(user)) &&
      user.assignedClassGroupIds.length > 0 &&
      !user.assignedClassGroupIds.includes(student.classGroupId)
    ) {
      throw new ForbiddenException('Student is outside user scope');
    }
  }

  private async calculateRates(studentIds: string[]) {
    const records = await this.prisma.attendance.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, status: true },
    });
    return studentIds.map((studentId) => {
      const studentRecords = records.filter(
        (record) => record.studentId === studentId,
      );
      return {
        studentId,
        rate: this.rateFromRecords(studentRecords),
      };
    });
  }

  private rateFromRecords(records: { status: string }[]) {
    if (records.length === 0) return 0;
    const present = records.filter((record) => record.status === 'PRESENT').length;
    return Math.round((present / records.length) * 100);
  }

  private recordsSince<T extends { date: string }>(records: T[], days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const key = since.toISOString().slice(0, 10);
    return records.filter((record) => record.date >= key);
  }

  private riskStatus(rate: number) {
    if (rate >= 90) return 'Cok iyi';
    if (rate >= 75) return 'Iyi';
    if (rate >= 60) return 'Takip edilmeli';
    return 'Riskli';
  }

  private async ensureClassGroupInInstitution(
    classGroupId: string,
    institutionId: string,
  ) {
    const classGroup = await this.prisma.classGroup.findUnique({
      where: { id: classGroupId },
      select: { id: true, institutionId: true, isActive: true },
    });
    if (
      !classGroup ||
      !classGroup.isActive ||
      classGroup.institutionId !== institutionId
    ) {
      throw new ForbiddenException('Class group must be active and belong to the institution');
    }
  }
}

const studentAttendanceSelect = {
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
