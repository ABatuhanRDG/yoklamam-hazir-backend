import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  canAccessInstitution,
  isGlobalUser,
  isSuperAdmin,
} from '../common/permissions/permissions';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';

@Injectable()
export class InstitutionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser) {
    if (isGlobalUser(user)) {
      return this.prisma.institution.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }],
      });
    }

    if (!user.institutionId) return [];

    return this.prisma.institution.findMany({
      where: { id: user.institutionId, isActive: true },
    });
  }

  async findOne(user: AuthenticatedUser, id: string) {
    if (!canAccessInstitution(user, id)) {
      throw new ForbiddenException('You cannot access this institution');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id },
    });
    if (!institution || !institution.isActive) {
      throw new NotFoundException('Institution not found');
    }
    return institution;
  }

  async create(user: AuthenticatedUser, dto: CreateInstitutionDto) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('Only super_admin can create institutions');
    }

    return this.prisma.institution.create({
      data: this.cleanCreateInstitutionData(dto),
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateInstitutionDto) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('Only super_admin can update institutions');
    }

    await this.ensureInstitutionExists(id);
    return this.prisma.institution.update({
      where: { id },
      data: this.cleanUpdateInstitutionData(dto),
    });
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('Only super_admin can deactivate institutions');
    }

    await this.ensureInstitutionExists(id);
    return this.prisma.institution.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureInstitutionExists(id: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id },
    });
    if (!institution || !institution.isActive) {
      throw new NotFoundException('Institution not found');
    }
  }

  private cleanCreateInstitutionData(dto: CreateInstitutionDto) {
    return {
      name: dto.name.trim(),
      city: dto.city.trim(),
      district: dto.district.trim(),
      address: dto.address?.trim() || null,
      phone: dto.phone?.trim() || null,
    };
  }

  private cleanUpdateInstitutionData(dto: UpdateInstitutionDto) {
    return {
      name: dto.name?.trim(),
      city: dto.city?.trim(),
      district: dto.district?.trim(),
      address: dto.address === undefined ? undefined : dto.address.trim() || null,
      phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
    };
  }
}
