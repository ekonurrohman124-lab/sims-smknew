import { statSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { applySubjectMaster, assertSubjectCatalogReady } from "../src/modules/academic/vocational-master.service.ts";
import { vocationalSubjects } from "../src/modules/academic/vocational-master.catalog.ts";

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
  const [students, classes, users, curricula, placements, teachers, teachings, subjects] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.schoolClass.count({ where: { schoolId } }),
    prisma.user.count(),
    prisma.curriculum.count({ where: { schoolId } }),
    prisma.curriculumPlacement.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.teachingAssignment.count({ where: { schoolId } }),
    prisma.subject.count({ where: { schoolId } }),
  ]);
  return { students, classes, users, curricula, placements, teachers, teachings, subjects };
}

async function main(): Promise<void> {
  assertSubjectCatalogReady();
  if (vocationalSubjects.length !== 30) throw new Error("Katalog mata pelajaran belum tervalidasi.");
  if (apply && !backupPath) throw new Error("Backup wajib ada sebelum mata pelajaran disimpan.");
  if (apply) {
    const backup = statSync(backupPath);
    if (!backup.isFile() || backup.size < 100_000) throw new Error("Berkas backup tidak valid. Perubahan dihentikan.");
  }
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
  const url = new URL(sourceUrl);
  if ((url.hostname !== "localhost" && url.hostname !== "127.0.0.1") || databaseName(sourceUrl) !== ALLOWED_DATABASE) {
    throw new Error("Master mata pelajaran hanya untuk database lokal sims_sakti_qc.");
  }
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const current = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== ALLOWED_DATABASE) throw new Error("Database aktif bukan sims_sakti_qc.");
    const school = await prisma.school.findUnique({ where: { npsn: ALLOWED_NPSN }, select: { id: true, name: true } });
    if (!school || school.name !== ALLOWED_SCHOOL) throw new Error("Identitas sekolah tidak sesuai. Proses dihentikan.");
    const before = await fingerprint(prisma, school.id);
    if (before.students !== 906 || before.classes !== 30 || before.users !== 22 || before.curricula !== 0 || before.placements !== 0) {
      throw new Error("Kondisi sekolah tidak sesuai batas tiket. Tidak ada data yang diubah.");
    }
    if (!apply) {
      console.log(JSON.stringify({ ready: vocationalSubjects.length, before, written: false }));
      return;
    }
    const result = await applySubjectMaster(prisma, school.id);
    const after = await fingerprint(prisma, school.id);
    const rows = await prisma.subject.findMany({
      where: { schoolId: school.id },
      select: { code: true, name: true },
    });
    const duplicateCode = new Set(rows.map((item) => item.code)).size !== rows.length;
    const duplicateName = new Set(rows.map((item) => item.name)).size !== rows.length;
    const stable = before.students === after.students
      && before.classes === after.classes
      && before.users === after.users
      && before.curricula === after.curricula
      && before.placements === after.placements
      && before.teachers === after.teachers
      && before.teachings === after.teachings;
    if (!stable || duplicateCode || duplicateName || after.subjects !== 30 || result.curriculaCreated !== 0 || result.placementsCreated !== 0) {
      throw new Error("Hasil pemasukan tidak sesuai batas tiket.");
    }
    console.log(JSON.stringify({
      subjectsCreated: result.subjectsCreated,
      unchanged: result.unchanged,
      conflicts: result.conflicts.length,
      subjects: after.subjects,
      students: after.students,
      classes: after.classes,
      users: after.users,
      curricula: after.curricula,
      placements: after.placements,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pemasukan mata pelajaran dihentikan.");
  process.exitCode = 1;
});
