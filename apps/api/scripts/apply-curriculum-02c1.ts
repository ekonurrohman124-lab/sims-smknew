import { statSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { applyCurriculumFoundation } from "../src/modules/academic/vocational-master.service.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ALLOWED_DATABASE = "sims_sakti_qc";
const ALLOWED_NPSN = "10814092";
const ALLOWED_SCHOOL = "SMK PGRI Pasir Sakti";
const apply = process.argv.includes("--apply");
const backupPath = process.argv.find((item) => item.startsWith("--backup="))?.slice("--backup=".length) ?? "";

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

async function fingerprint(prisma: PrismaClient, schoolId: string) {
  const [students, classes, users, subjects, teachers, teachings, reports, grades] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.schoolClass.count({ where: { schoolId } }),
    prisma.user.count(),
    prisma.subject.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.teachingAssignment.count({ where: { schoolId } }),
    prisma.reportCardWorkflow.count({ where: { schoolId } }),
    prisma.gradeFinalResult.count({ where: { schoolId } }),
  ]);
  return { students, classes, users, subjects, teachers, teachings, reports, grades };
}

async function main(): Promise<void> {
  if (apply && !backupPath) throw new Error("Backup wajib ada sebelum kurikulum disimpan.");
  if (apply) {
    const backup = statSync(backupPath);
    if (!backup.isFile() || backup.size < 100_000) throw new Error("Berkas backup tidak valid. Perubahan dihentikan.");
  }
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
  const url = new URL(sourceUrl);
  if ((url.hostname !== "localhost" && url.hostname !== "127.0.0.1") || databaseName(sourceUrl) !== ALLOWED_DATABASE) {
    throw new Error("Kurikulum hanya untuk database lokal sims_sakti_qc.");
  }
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const current = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== ALLOWED_DATABASE) throw new Error("Database aktif bukan sims_sakti_qc.");
    const school = await prisma.school.findUnique({ where: { npsn: ALLOWED_NPSN }, select: { id: true, name: true } });
    if (!school || school.name !== ALLOWED_SCHOOL) throw new Error("Identitas sekolah tidak sesuai. Proses dihentikan.");
    const year = await prisma.academicYear.findFirst({
      where: { schoolId: school.id, name: "2026/2027", isActive: true },
      select: { id: true },
    });
    if (!year) throw new Error("Tahun pelajaran 2026/2027 tidak aktif. Proses dihentikan.");
    const before = await fingerprint(prisma, school.id);
    if (before.students !== 906 || before.classes !== 30 || before.users !== 22 || before.subjects !== 30) {
      throw new Error("Kondisi sekolah tidak sesuai batas tiket. Tidak ada data yang diubah.");
    }
    if (!apply) {
      console.log(JSON.stringify({ ready: true, before, written: false }));
      return;
    }
    const result = await applyCurriculumFoundation(prisma, school.id, year.id);
    const after = await fingerprint(prisma, school.id);
    const [curricula, faseE, faseF, placements] = await Promise.all([
      prisma.curriculum.count({ where: { schoolId: school.id, code: "KM-2026" } }),
      prisma.schoolClass.count({ where: { schoolId: school.id, fase: "E" } }),
      prisma.schoolClass.count({ where: { schoolId: school.id, fase: "F" } }),
      prisma.curriculumPlacement.count({ where: { schoolId: school.id } }),
    ]);
    const stable = before.students === after.students
      && before.classes === after.classes
      && before.users === after.users
      && before.subjects === after.subjects
      && before.teachers === after.teachers
      && before.teachings === after.teachings
      && before.reports === after.reports
      && before.grades === after.grades;
    if (!stable || curricula !== 1 || faseE !== 13 || faseF !== 17 || placements !== 245) {
      throw new Error("Hasil kurikulum tidak sesuai batas tiket.");
    }
    console.log(JSON.stringify({ ...result, curricula, faseE, faseF, placements, students: after.students, classes: after.classes, subjects: after.subjects, users: after.users }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Aktivasi kurikulum dihentikan.");
  process.exitCode = 1;
});
