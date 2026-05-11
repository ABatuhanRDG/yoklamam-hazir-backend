import { GlobalRole, InstitutionRole } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  globalRole: GlobalRole | null;
  institutionId: string | null;
  institutionRole: InstitutionRole | null;
  assignedClassGroupIds: string[];
};
