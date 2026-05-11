import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyClassGroupScope,
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
  requireInstitutionAccess,
  requireInstitutionManagement,
} from '../common/permissions/permissions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassGroupDto } from './dto/create-class-group.dto';
import { UpdateClassGroupDto } from './dto/update-class-group.dto';

type ListClassGroupsQuery = {
  institutionId?: string;
  includeInactive?: string;
};

@Injectable()
export class ClassGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, query: ListClassGroupsQuery) {
    const institutionId = getScopedInstitutionIdOrThrow(user, query.institutionId);
    const where: Prisma.ClassGroupWhereInput = {};
    if (institutionId) where.institutionId = institutionId;
    if (query.includeInactive !== 'true') where.isActive = true;

    return this.prisma.classGroup.findMany({
      where: applyClassGroupScope(user, where),
      orderBy: [{ name: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateClassGroupDto) {
    if (isGlobalManager(user)) {
      throw new ForbiddenException('global_manager cannot create class groups');
    }
    requireInstitutionManagement(user, dto.institutionId);
    await this.ensureActiveInstitution(dto.institutionId);

    return this.prisma.classGroup.create({
      data: {
        institutionId: dto.institutionId,
        name: dto.name.trim(),
        teacherName: dto.teacherName.trim(),
      },
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateClassGroupDto) {
    const classGroup = await this.findExisting(id);
    requireInstitutionManagement(user, classGroup.institutionId);

    return this.prisma.classGroup.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        teacherName: dto.teacherName?.trim(),
        isActive: dto.isActive,
      },
    });
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    const classGroup = await this.findExisting(id);
    requireInstitutionManagement(user, classGroup.institutionId);

    return this.prisma.classGroup.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureActiveInstitution(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, isActive: true },
    });
    if (!institution || !institution.isActive) {
      throw new NotFoundException('Institution not found');
    }
  }

  private async findExisting(id: string) {
    const classGroup = await this.prisma.classGroup.findUnique({
      where: { id },
    });
    if (!classGroup) throw new NotFoundException('Class group not found');
    return classGroup;
  }
}
