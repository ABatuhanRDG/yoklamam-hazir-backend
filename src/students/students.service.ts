import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyStudentClassGroupScope,
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
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
