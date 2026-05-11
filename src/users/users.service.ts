import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalRole, InstitutionRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  getScopedInstitutionIdOrThrow,
  isGlobalManager,
  isInstitutionAdmin,
  isRecorder,
  isSuperAdmin,
  isViewer,
} from '../common/permissions/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGlobalManagerDto } from './dto/create-global-manager.dto';
import { CreateInstitutionUserDto } from './dto/create-institution-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type ListUsersQuery = {
  institutionId?: string;
  role?: string;
  includeInactive?: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, query: ListUsersQuery) {
    if (isRecorder(user) || isViewer(user)) {
      throw new ForbiddenException('You cannot list users');
    }

    const includeInactive = query.includeInactive === 'true';
    const where: Prisma.UserWhereInput = {};

    if (!includeInactive) where.isActive = true;

    if (isSuperAdmin(user) || isGlobalManager(user)) {
      if (query.institutionId) where.institutionId = query.institutionId;
    } else if (isInstitutionAdmin(user)) {
      where.institutionId = getScopedInstitutionIdOrThrow(
        user,
        query.institutionId,
      );
      where.institutionRole = { in: [InstitutionRole.RECORDER, InstitutionRole.VIEWER] };
    }

    if (query.role) {
      if (Object.values(GlobalRole).includes(query.role as GlobalRole)) {
        where.globalRole = query.role as GlobalRole;
      } else if (
        Object.values(InstitutionRole).includes(query.role as InstitutionRole)
      ) {
        where.institutionRole = query.role as InstitutionRole;
      }
    }

    return this.prisma.user.findMany({
      where,
      select: safeUserSelect,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createGlobalManager(user: AuthenticatedUser, dto: CreateGlobalManagerDto) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('Only super_admin can create global managers');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName?.trim() || null,
        globalRole: GlobalRole.GLOBAL_MANAGER,
        institutionId: null,
        institutionRole: null,
        assignedClassGroupIds: [],
        isActive: true,
      },
      select: safeUserSelect,
    });

    return created;
  }

  async createInstitutionUser(
    user: AuthenticatedUser,
    dto: CreateInstitutionUserDto,
  ) {
    this.assertCanCreateInstitutionUser(user, dto);
    await this.ensureActiveInstitution(dto.institutionId);
    await this.ensureClassGroupsBelongToInstitution(
      dto.institutionId,
      dto.assignedClassGroupIds ?? [],
    );

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email is already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName?.trim() || null,
        globalRole:
          dto.institutionRole === InstitutionRole.RECORDER
            ? GlobalRole.GROUP_MANAGER
            : null,
        institutionId: dto.institutionId,
        institutionRole: dto.institutionRole,
        assignedClassGroupIds: dto.assignedClassGroupIds ?? [],
        isActive: true,
      },
      select: safeUserSelect,
    });
  }

  async updateUser(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
    if (!target) throw new NotFoundException('User not found');

    this.assertCanUpdateTargetUser(user, target);

    const targetInstitutionId = target.institutionId;
    if (dto.assignedClassGroupIds && targetInstitutionId) {
      await this.ensureClassGroupsBelongToInstitution(
        targetInstitutionId,
        dto.assignedClassGroupIds,
      );
    }

    if (
      isInstitutionAdmin(user) &&
      dto.institutionRole === InstitutionRole.INSTITUTION_ADMIN
    ) {
      throw new ForbiddenException('Institution admin cannot promote users');
    }

    const data: Prisma.UserUpdateInput = {
      fullName: dto.fullName === undefined ? undefined : dto.fullName.trim() || null,
      isActive: dto.isActive,
      institutionRole: dto.institutionRole,
      assignedClassGroupIds: dto.assignedClassGroupIds,
    };
    const nextInstitutionRole = dto.institutionRole ?? target.institutionRole;
    if (nextInstitutionRole === InstitutionRole.RECORDER) {
      data.globalRole = GlobalRole.GROUP_MANAGER;
    } else if (target.globalRole === GlobalRole.GROUP_MANAGER) {
      data.globalRole = null;
    }

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: safeUserSelect,
    });
  }

  async deactivateUser(user: AuthenticatedUser, id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
    if (!target) throw new NotFoundException('User not found');

    this.assertCanUpdateTargetUser(user, target);
    if (target.globalRole === GlobalRole.SUPER_ADMIN) {
      const activeSuperAdminCount = await this.prisma.user.count({
        where: { globalRole: GlobalRole.SUPER_ADMIN, isActive: true },
      });
      if (activeSuperAdminCount <= 1) {
        throw new ForbiddenException('Cannot deactivate the last super_admin');
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: safeUserSelect,
    });
  }

  private assertCanCreateInstitutionUser(
    user: AuthenticatedUser,
    dto: CreateInstitutionUserDto,
  ) {
    if (isGlobalManager(user) || isRecorder(user) || isViewer(user)) {
      throw new ForbiddenException('You cannot create users');
    }

    if (isSuperAdmin(user)) return;

    if (!isInstitutionAdmin(user)) {
      throw new ForbiddenException('You cannot create users');
    }

    if (dto.institutionId !== user.institutionId) {
      throw new ForbiddenException('You cannot create users for another institution');
    }
    if (dto.institutionRole === InstitutionRole.INSTITUTION_ADMIN) {
      throw new ForbiddenException('Institution admin cannot create institution_admin users');
    }
  }

  private assertCanUpdateTargetUser(
    user: AuthenticatedUser,
    target: {
      globalRole: GlobalRole | null;
      institutionId: string | null;
      institutionRole: InstitutionRole | null;
    },
  ) {
    if (isGlobalManager(user) || isRecorder(user) || isViewer(user)) {
      throw new ForbiddenException('You cannot update users');
    }

    if (isSuperAdmin(user)) return;

    if (!isInstitutionAdmin(user)) {
      throw new ForbiddenException('You cannot update users');
    }
    if (target.institutionId !== user.institutionId) {
      throw new ForbiddenException('You cannot update users from another institution');
    }
    if (
      target.institutionRole !== InstitutionRole.RECORDER &&
      target.institutionRole !== InstitutionRole.VIEWER
    ) {
      throw new ForbiddenException('Institution admin can update only recorder/viewer users');
    }
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

  private async ensureClassGroupsBelongToInstitution(
    institutionId: string,
    classGroupIds: string[],
  ) {
    if (classGroupIds.length === 0) return;
    const count = await this.prisma.classGroup.count({
      where: {
        id: { in: classGroupIds },
        institutionId,
        isActive: true,
      },
    });
    if (count !== classGroupIds.length) {
      throw new ForbiddenException('Assigned class groups must belong to the same institution');
    }
  }
}

export const safeUserSelect = {
  id: true,
  email: true,
  fullName: true,
  globalRole: true,
  institutionId: true,
  institutionRole: true,
  assignedClassGroupIds: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
