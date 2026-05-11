import { SetMetadata } from '@nestjs/common';
import { GlobalRole, InstitutionRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

export type AllowedRole = GlobalRole | InstitutionRole;

export const Roles = (...roles: AllowedRole[]) => SetMetadata(ROLES_KEY, roles);
