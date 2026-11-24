ALTER TABLE "AlumniTracer" ADD COLUMN "studentId" TEXT;

CREATE UNIQUE INDEX "AlumniTracer_schoolId_studentId_graduationYear_key" ON "AlumniTracer"("schoolId", "studentId", "graduationYear");

ALTER TABLE "AlumniTracer" ADD CONSTRAINT "AlumniTracer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
