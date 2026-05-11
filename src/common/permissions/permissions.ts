import { ForbiddenException } from '@nestjs/common';
import { GlobalRole, InstitutionRole, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../types/authenticated-user';

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.globalRole === GlobalRole.SUPER_ADMIN;
}

export function isGlobalManager(user: AuthenticatedUser): boolean {
  return user.globalRole === GlobalRole.GLOBAL_MANAGER;
}

export function isGlobalUser(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user) || isGlobalManager(user);
}

export function isInstitutionAdmin(user: AuthenticatedUser): boolean {
  return user.institutionRole === InstitutionRole.INSTITUTION_ADMIN;
}

export function isRecorder(user: AuthenticatedUser): boolean {
  return user.institutionRole === InstitutionRole.RECORDER;
}

export function isViewer(user: AuthenticatedUser): boolean {
  return user.institutionRole === InstitutionRole.VIEWER;
}

export function canManageInstitutions(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}

export function canManageGlobalManagers(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}

export function canManageInstitutionUsers(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user) || isInstitutionAdmin(user);
}

export function canTakeAttendance(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user) || isGlobalManager(user) || isInstitutionAdmin(user) || isRecorder(user);
}

export function canViewReports(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user) || isGlobalManager(user) || isInstitutionAdmin(user) || isViewer(user);
}

export function canExportReports(user: AuthenticatedUser): boolean {
  return canViewReports(user);
}

export function canAccessInstitution(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  if (isGlobalUser(user)) return true;
  return user.institutionId === institutionId;
}

export function canManageInstitutionData(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  if (isSuperAdmin(user)) return true;
  return isInstitutionAdmin(user) && user.institutionId === institutionId;
}

export function canViewInstitutionData(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  if (isGlobalUser(user)) return true;
  return user.institutionId === institutionId;
}

export function canManageUsers(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  return canManageInstitutionData(user, institutionId);
}

export function canManageClassGroups(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  return canManageInstitutionData(user, institutionId);
}

export function canManageStudents(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  return canManageInstitutionData(user, institutionId);
}

export function canManagePrayerTypes(
  user: AuthenticatedUser,
  institutionId: string,
): boolean {
  return canManageInstitutionData(user, institutionId);
}

export function getScopedInstitutionIdOrThrow(
  user: AuthenticatedUser,
  requestedInstitutionId?: string,
): string | undefined {
  if (isGlobalUser(user)) return requestedInstitutionId;
  if (!user.institutionId) {
    throw new ForbiddenException('Institution scope is required');
  }
  if (requestedInstitutionId && requestedInstitutionId !== user.institutionId) {
    throw new ForbiddenException('You cannot access another institution');
  }
  return user.institutionId;
}

export function requireInstitutionAccess(
  user: AuthenticatedUser,
  institutionId: string,
): void {
  if (!canViewInstitutionData(user, institutionId)) {
    throw new ForbiddenException('You cannot access another institution');
  }
}

export function requireInstitutionManagement(
  user: AuthenticatedUser,
  institutionId: string,
): void {
  if (!canManageInstitutionData(user, institutionId)) {
    throw new ForbiddenException('You cannot manage this institution data');
  }
}

export function applyClassGroupScope<T extends Prisma.ClassGroupWhereInput>(
  user: AuthenticatedUser,
  where: T,
): T {
  if (
    (isRecorder(user) || isViewer(user)) &&
    user.assignedClassGroupIds.length > 0
  ) {
    return {
      ...where,
      id: { in: user.assignedClassGroupIds },
    };
  }
  return where;
}

export function applyStudentClassGroupScope<T extends Prisma.StudentWhereInput>(
  user: AuthenticatedUser,
  where: T,
): T {
  if (
    (isRecorder(user) || isViewer(user)) &&
    user.assignedClassGroupIds.length > 0
  ) {
    return {
      ...where,
      classGroupId: { in: user.assignedClassGroupIds },
    };
  }
  return where;
}
