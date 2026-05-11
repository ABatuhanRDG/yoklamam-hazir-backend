import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
  requireInstitutionManagement,
} from '../common/permissions/permissions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePrayerTypeDto } from './dto/create-prayer-type.dto';
import { ReorderPrayerTypesDto } from './dto/reorder-prayer-types.dto';
import { UpdatePrayerTypeDto } from './dto/update-prayer-type.dto';

type ListPrayerTypesQuery = {
  institutionId?: string;
  includeInactive?: string;
};

@Injectable()
export class PrayerTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, query: ListPrayerTypesQuery) {
    const institutionId = getScopedInstitutionIdOrThrow(user, query.institutionId);
    const where: Prisma.PrayerTypeWhereInput = {};
    if (institutionId) where.institutionId = institutionId;
    if (query.includeInactive !== 'true') where.isActive = true;

    return this.prisma.prayerType.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreatePrayerTypeDto) {
    if (isGlobalManager(user)) {
      throw new ForbiddenException('global_manager cannot create prayer types');
    }
    requireInstitutionManagement(user, dto.institutionId);
    await this.ensureActiveInstitution(dto.institutionId);

    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(dto.institutionId));
    return this.prisma.prayerType.create({
      data: {
        institutionId: dto.institutionId,
        name: dto.name.trim(),
        sortOrder,
      },
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePrayerTypeDto) {
    const prayerType = await this.findExisting(id);
    requireInstitutionManagement(user, prayerType.institutionId);

    return this.prisma.prayerType.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    const prayerType = await this.findExisting(id);
    requireInstitutionManagement(user, prayerType.institutionId);

    return this.prisma.prayerType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async reorder(user: AuthenticatedUser, dto: ReorderPrayerTypesDto) {
    requireInstitutionManagement(user, dto.institutionId);

    const ids = dto.items.map((item) => item.id);
    const count = await this.prisma.prayerType.count({
      where: {
        id: { in: ids },
        institutionId: dto.institutionId,
      },
    });
    if (count !== ids.length) {
      throw new ForbiddenException('All prayer types must belong to the institution');
    }

    return this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.prayerType.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
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
    const prayerType = await this.prisma.prayerType.findUnique({ where: { id } });
    if (!prayerType) throw new NotFoundException('Prayer type not found');
    return prayerType;
  }

  private async nextSortOrder(institutionId: string) {
    const last = await this.prisma.prayerType.findFirst({
      where: { institutionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}
