-- Additive student profile fields for school roster import.
-- Existing rows stay unchanged. Empty values remain NULL.
ALTER TABLE "Student" ADD COLUMN "fatherName" VARCHAR(120);
ALTER TABLE "Student" ADD COLUMN "motherName" VARCHAR(120);
ALTER TABLE "Student" ADD COLUMN "nik" VARCHAR(16);
ALTER TABLE "Student" ADD COLUMN "familyCardNo" VARCHAR(16);
ALTER TABLE "Student" ADD COLUMN "originSchool" VARCHAR(160);
ALTER TABLE "Student" ADD COLUMN "religion" VARCHAR(40);
ALTER TABLE "Student" ADD COLUMN "address" VARCHAR(300);
ALTER TABLE "Student" ADD COLUMN "studentNote" VARCHAR(300);

-- PostgreSQL unique allows many NULL nik values. A real NIK cannot be shared.
CREATE UNIQUE INDEX "Student_nik_key" ON "Student"("nik");
