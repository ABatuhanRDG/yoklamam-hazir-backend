import { PrismaClient, GlobalRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log('Seed skipped: at least one user already exists.');
    return;
  }

  const passwordHash = await bcrypt.hash('admin123456', 12);

  await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash,
      globalRole: GlobalRole.SUPER_ADMIN,
      institutionId: null,
      institutionRole: null,
      assignedClassGroupIds: [],
      isActive: true,
    },
  });

  console.log('Created first super_admin: admin@example.com / admin123456');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
