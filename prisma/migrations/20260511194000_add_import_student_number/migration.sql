-- AlterTable
ALTER TABLE "Student" ADD COLUMN "studentNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Student_institutionId_studentNumber_key" ON "Student"("institutionId", "studentNumber");
