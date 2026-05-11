-- AlterEnum
ALTER TYPE "GlobalRole" ADD VALUE IF NOT EXISTS 'GROUP_MANAGER';

-- AlterTable
ALTER TABLE "ClassGroup" ADD COLUMN "teacherUserId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_institutionId_name_key" ON "ClassGroup"("institutionId", "name");

-- CreateIndex
CREATE INDEX "ClassGroup_teacherUserId_idx" ON "ClassGroup"("teacherUserId");

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
