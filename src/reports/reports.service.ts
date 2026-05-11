import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import {
  getScopedInstitutionIdOrThrow,
  isGlobalUser,
  isRecorder,
} from '../common/permissions/permissions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  assertDateString,
  calculateBuckets,
  calculatePercentiles,
  calculateRate,
  parseCsvIds,
} from '../common/utils/report.helpers';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthenticatedUser, query: ReportQueryDto) {
    const scope = await this.buildReportScope(user, query);
    const totals = this.calculateTotals(scope.attendance);

    return {
      institution: {
        id: scope.institution.id,
        name: scope.institution.name,
      },
      dateRange: {
        startDate: query.startDate,
        endDate: query.endDate,
      },
      totalPresent: totals.present,
      totalAbsent: totals.absent,
      totalRecords: totals.total,
      overallRate: calculateRate(totals.present, totals.absent),
    };
  }

  async classSummary(user: AuthenticatedUser, query: ReportQueryDto) {
    const scope = await this.buildReportScope(user, query);

    return {
      classes: scope.classGroups.map((classGroup) => {
        const studentIds = new Set(
          scope.students
            .filter((student) => student.classGroupId === classGroup.id)
            .map((student) => student.id),
        );
        const attendance = scope.attendance.filter((record) =>
          studentIds.has(record.studentId),
        );
        const totals = this.calculateTotals(attendance);
        return {
          classGroupId: classGroup.id,
          className: classGroup.name,
          teacherName: classGroup.teacherName,
          totalPresent: totals.present,
          totalAbsent: totals.absent,
          totalRecords: totals.total,
          rate: calculateRate(totals.present, totals.absent),
        };
      }),
    };
  }

  async studentSummary(user: AuthenticatedUser, query: ReportQueryDto) {
    const scope = await this.buildReportScope(user, query);
    const prayerTypeMap = new Map(
      scope.prayerTypes.map((prayerType) => [prayerType.id, prayerType]),
    );

    const students = scope.students.map((student) => {
      const studentAttendance = scope.attendance.filter(
        (record) => record.studentId === student.id,
      );
      const totals = this.calculateTotals(studentAttendance);
      const prayerBreakdown = scope.prayerTypes.map((prayerType) => {
        const records = studentAttendance.filter(
          (record) => record.prayerTypeId === prayerType.id,
        );
        const prayerTotals = this.calculateTotals(records);
        return {
          prayerTypeId: prayerType.id,
          prayerTypeName: prayerTypeMap.get(prayerType.id)?.name ?? prayerType.name,
          present: prayerTotals.present,
          absent: prayerTotals.absent,
          total: prayerTotals.total,
          rate: calculateRate(prayerTotals.present, prayerTotals.absent),
        };
      });

      return {
        studentId: student.id,
        studentName: student.fullName,
        classGroupId: student.classGroupId,
        className: student.classGroup.name,
        teacherName: student.classGroup.teacherName,
        totalPresent: totals.present,
        totalAbsent: totals.absent,
        totalRecords: totals.total,
        rate: calculateRate(totals.present, totals.absent),
        prayerBreakdown,
      };
    });

    return {
      students: this.sortStudents(students, query.sortBy, query.sortDirection),
    };
  }

  async studentDetail(
    user: AuthenticatedUser,
    studentId: string,
    query: ReportQueryDto,
  ) {
    this.assertCanViewReports(user);
    assertDateString(query.startDate, 'startDate');
    assertDateString(query.endDate, 'endDate');

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { classGroup: true, institution: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const institutionId = getScopedInstitutionIdOrThrow(user, student.institutionId);
    if (institutionId !== student.institutionId) {
      throw new ForbiddenException('You cannot access this student');
    }
    this.enforceAssignedClassScope(user, [student.classGroupId]);

    const prayerTypeIds = parseCsvIds(query.prayerTypeIds);
    const prayerTypes = await this.findPrayerTypes(
      student.institutionId,
      prayerTypeIds,
      query.includeInactivePrayerTypes === true,
    );
    const attendance = await this.prisma.attendance.findMany({
      where: {
        institutionId: student.institutionId,
        studentId,
        date: { gte: query.startDate, lte: query.endDate },
        prayerTypeId: { in: prayerTypes.map((item) => item.id) },
      },
    });
    const totals = this.calculateTotals(attendance);
    const prayerBreakdown = prayerTypes.map((prayerType) => {
      const records = attendance.filter((record) => record.prayerTypeId === prayerType.id);
      const prayerTotals = this.calculateTotals(records);
      return {
        prayerTypeId: prayerType.id,
        prayerTypeName: prayerType.name,
        present: prayerTotals.present,
        absent: prayerTotals.absent,
        total: prayerTotals.total,
        rate: calculateRate(prayerTotals.present, prayerTotals.absent),
      };
    });

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        classGroupId: student.classGroupId,
        className: student.classGroup.name,
        teacherName: student.classGroup.teacherName,
      },
      summary: {
        totalPresent: totals.present,
        totalAbsent: totals.absent,
        totalRecords: totals.total,
        rate: calculateRate(totals.present, totals.absent),
      },
      prayerBreakdown,
      chartData: {
        donut: {
          present: totals.present,
          absent: totals.absent,
        },
        bar: prayerBreakdown.map((item) => ({
          label: item.prayerTypeName,
          present: item.present,
          absent: item.absent,
          rate: item.rate,
        })),
      },
    };
  }

  async percentiles(user: AuthenticatedUser, query: ReportQueryDto) {
    const scope = await this.buildReportScope(user, query);
    const studentSummary = await this.studentSummary(user, query);
    const rateByStudentId = new Map(
      studentSummary.students.map((student) => [student.studentId, student.rate]),
    );

    return {
      classes: scope.classGroups.map((classGroup) => {
        const classStudents = scope.students.filter(
          (student) => student.classGroupId === classGroup.id,
        );
        const rates = classStudents.map(
          (student) => rateByStudentId.get(student.id) ?? 0,
        );
        const percentiles = calculatePercentiles(rates);
        return {
          classGroupId: classGroup.id,
          className: classGroup.name,
          teacherName: classGroup.teacherName,
          studentCount: classStudents.length,
          buckets: calculateBuckets(rates),
          ...percentiles,
        };
      }),
    };
  }

  private async buildReportScope(user: AuthenticatedUser, query: ReportQueryDto) {
    this.assertCanViewReports(user);
    assertDateString(query.startDate, 'startDate');
    assertDateString(query.endDate, 'endDate');

    if (isGlobalUser(user) && !query.institutionId) {
      throw new BadRequestException('institutionId is required');
    }
    const institutionId = getScopedInstitutionIdOrThrow(user, query.institutionId);
    if (!institutionId) throw new BadRequestException('institutionId is required');

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, name: true, isActive: true },
    });
    if (!institution || !institution.isActive) {
      throw new NotFoundException('Institution not found');
    }

    const requestedClassGroupIds = parseCsvIds(query.classGroupIds);
    this.enforceAssignedClassScope(user, requestedClassGroupIds);

    const scopedRequestedClassGroupIds = this.applyAssignedClassFilter(
      user,
      requestedClassGroupIds,
    );
    const classGroups = await this.findClassGroups(
      institutionId,
      scopedRequestedClassGroupIds,
    );
    const classGroupIds = classGroups.map((classGroup) => classGroup.id);
    const prayerTypeIds = parseCsvIds(query.prayerTypeIds);
    const prayerTypes = await this.findPrayerTypes(
      institutionId,
      prayerTypeIds,
      query.includeInactivePrayerTypes === true,
    );

    const students = await this.prisma.student.findMany({
      where: {
        institutionId,
        classGroupId: { in: classGroupIds },
        ...(query.includeInactiveStudents ? {} : { isActive: true }),
      },
      include: { classGroup: true },
      orderBy: { fullName: 'asc' },
    });

    const attendance = await this.prisma.attendance.findMany({
      where: {
        institutionId,
        date: { gte: query.startDate, lte: query.endDate },
        studentId: { in: students.map((student) => student.id) },
        prayerTypeId: { in: prayerTypes.map((prayerType) => prayerType.id) },
      },
    });

    return { institution, classGroups, prayerTypes, students, attendance };
  }

  private assertCanViewReports(user: AuthenticatedUser) {
    if (isRecorder(user)) {
      throw new ForbiddenException('Recorder cannot view reports');
    }
  }

  private enforceAssignedClassScope(
    user: AuthenticatedUser,
    requestedClassGroupIds: string[],
  ) {
    if (user.institutionRole !== 'VIEWER' || user.assignedClassGroupIds.length === 0) {
      return;
    }
    const allowed = new Set(user.assignedClassGroupIds);
    const outsideScope = requestedClassGroupIds.some((id) => !allowed.has(id));
    if (outsideScope) {
      throw new ForbiddenException('Class group is outside user scope');
    }
  }

  private applyAssignedClassFilter(
    user: AuthenticatedUser,
    requestedClassGroupIds: string[],
  ) {
    if (user.institutionRole !== 'VIEWER' || user.assignedClassGroupIds.length === 0) {
      return requestedClassGroupIds;
    }
    if (requestedClassGroupIds.length > 0) return requestedClassGroupIds;
    return user.assignedClassGroupIds;
  }

  private async findClassGroups(institutionId: string, requestedIds: string[]) {
    const where: Prisma.ClassGroupWhereInput = {
      institutionId,
      isActive: true,
    };
    if (requestedIds.length > 0) where.id = { in: requestedIds };
    const classGroups = await this.prisma.classGroup.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    if (requestedIds.length > 0 && classGroups.length !== requestedIds.length) {
      throw new ForbiddenException('Class groups must belong to the institution');
    }
    return classGroups;
  }

  private async findPrayerTypes(
    institutionId: string,
    requestedIds: string[],
    includeInactive: boolean,
  ) {
    const where: Prisma.PrayerTypeWhereInput = {
      institutionId,
      ...(includeInactive ? {} : { isActive: true }),
    };
    if (requestedIds.length > 0) where.id = { in: requestedIds };
    const prayerTypes = await this.prisma.prayerType.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (requestedIds.length > 0 && prayerTypes.length !== requestedIds.length) {
      throw new ForbiddenException('Prayer types must belong to the institution');
    }
    return prayerTypes;
  }

  private calculateTotals(records: { status: AttendanceStatus }[]) {
    const present = records.filter((record) => record.status === AttendanceStatus.PRESENT).length;
    const absent = records.filter((record) => record.status === AttendanceStatus.ABSENT).length;
    return { present, absent, total: present + absent };
  }

  private sortStudents<T extends {
    studentName: string;
    rate: number;
    totalPresent: number;
    totalAbsent: number;
  }>(students: T[], sortBy = 'name', sortDirection: 'asc' | 'desc' = 'asc') {
    const direction = sortDirection === 'desc' ? -1 : 1;
    return [...students].sort((a, b) => {
      if (sortBy === 'rate') return (a.rate - b.rate) * direction;
      if (sortBy === 'present') return (a.totalPresent - b.totalPresent) * direction;
      if (sortBy === 'absent') return (a.totalAbsent - b.totalAbsent) * direction;
      return a.studentName.localeCompare(b.studentName) * direction;
    });
  }
}
