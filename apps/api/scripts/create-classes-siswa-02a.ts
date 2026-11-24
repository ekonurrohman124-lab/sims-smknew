import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { classSchema } from "../src/modules/academic/academic.schema.ts";
import { gradeLevelOfClass, readStudentWorkbook } from "../src/modules/academic/student-import.logic.ts";
import { expertiseConcentrations } from "../src/modules/academic/vocational-master.catalog.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ALLOWED_DATABASE = "sims_sakti_qc";
const ALLOWED_NPSN = "10814092";
const ALLOWED_SCHOOL = "SMK PGRI Pasir Sakti";
const ALLOWED_YEAR = "2026/2027";
const SOURCE_FILE = "C:\\Users\\User\\Downloads\\DATA SISWA 2026-2027 RI - UPDATE - 15-11-26.xlsx";
const EXPECTED_CLASSES = 30;
const CLASS_CAPACITY = 36;

const apply = process.argv.includes("--apply");
const backupPath = process.argv.find((item) => item.startsWith("--backup="))?.slice("--backup=".length) ?? "";

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function concentrationToken(name: string): string {
  const parts = name.replace(/\s+/g, " ").trim().split(" ").slice(1);
  if (/^\d+$/.test(parts.at(-1) ?? "")) parts.pop();
  return parts.join(" ").trim();
}

type ActiveConcentration = { id: string; code: string; name: string; programCode: string };

function matchConcentration(token: string, active: ActiveConcentration[]): ActiveConcentration | null {
  const key = token.toLocaleUpperCase("id-ID");
  const catalog = expertiseConcentrations.find((item) => item.schoolTrack && item.aliases.includes(key));
  if (catalog) {
    const row = active.find((item) => item.code === catalog.code);
    return row ?? null;
  }
  const byName = active.filter((item) => item.name.toLocaleUpperCase("id-ID") === key);
  return byName.length === 1 ? byName[0] : null;
}

async function plannedClasses(active: ActiveConcentration[]) {
  const workbook = await readStudentWorkbook(readFileSync(SOURCE_FILE));
  const ignored = workbook.sheets.filter((sheet) => sheet.role !== "students").map((sheet) => sheet.name);
  const names = workbook.sheets.filter((sheet) => sheet.role === "students").map((sheet) => sheet.name);
  if (names.length !== EXPECTED_CLASSES) {
    throw new Error(`Sumber berisi ${names.length} lembar kelas, bukan ${EXPECTED_CLASSES}. Perubahan dihentikan.`);
  }
  const plans = names.map((name) => {
    const gradeLevel = gradeLevelOfClass(name);
    const token = concentrationToken(name);
    const concentration = gradeLevel && token ? matchConcentration(token, active) : null;
    if (!gradeLevel || gradeLevel < 10 || gradeLevel > 12 || !concentration) {
      throw new Error(`Kelas ${name} tidak memiliki pemetaan konsentrasi yang tunggal. Perubahan dihentikan.`);
    }
    const input = classSchema.parse({
      academicYearId: "pending",
      concentrationId: concentration.id,
      name,
      gradeLevel,
      capacity: CLASS_CAPACITY,
      isActive: true,
    });
    return { ...input, code: concentration.code, concentrationName: concentration.name, token };
  });
  const uniqueNames = new Set(plans.map((item) => item.name.toLocaleLowerCase("id-ID")));
  if (uniqueNames.size !== plans.length) throw new Error("Nama kelas pada berkas terulang. Perubahan dihentikan.");
  return { ignored, plans };
}

async function main(): Promise<void> {
  if (apply && !backupPath) throw new Error("Backup wajib ada sebelum kelas disimpan.");
  if (apply) {
    const backup = statSync(backupPath);
    if (!backup.isFile() || backup.size < 100_000) throw new Error("Berkas backup tidak valid. Perubahan dihentikan.");
  }
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
  const url = new URL(sourceUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("Pembuatan kelas hanya untuk PostgreSQL lokal.");
  if (databaseName(sourceUrl) !== ALLOWED_DATABASE) throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const current = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== ALLOWED_DATABASE) throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
    const school = await prisma.school.findUnique({ where: { npsn: ALLOWED_NPSN }, select: { id: true, name: true, npsn: true } });
    if (!school || school.name !== ALLOWED_SCHOOL) throw new Error("Identitas sekolah tidak sesuai. Proses dihentikan.");
    const years = await prisma.academicYear.findMany({
      where: { schoolId: school.id, name: ALLOWED_YEAR },
      select: { id: true, name: true, isActive: true },
    });
    if (years.length !== 1 || !years[0]?.isActive) throw new Error("Tahun pelajaran 2026/2027 tidak aktif. Perubahan dihentikan.");
    const yearId = years[0].id;
    const opened = expertiseConcentrations.filter((item) => item.schoolTrack);
    const stored = await prisma.expertiseConcentration.findMany({
      where: { schoolId: school.id },
      select: { id: true, code: true, name: true, program: { select: { code: true } } },
      orderBy: { code: "asc" },
    });
    if (stored.length !== opened.length) throw new Error("Jumlah konsentrasi aktif tidak sesuai. Perubahan dihentikan.");
    const active: ActiveConcentration[] = opened.map((item) => {
      const row = stored.find((candidate) => candidate.code === item.code && candidate.name === item.name && candidate.program.code === item.programCode);
      if (!row) throw new Error(`Konsentrasi ${item.code} tidak sesuai data aktif. Perubahan dihentikan.`);
      return { id: row.id, code: row.code, name: row.name, programCode: row.program.code };
    });
    const { ignored, plans } = await plannedClasses(active);
    const prepared = plans.map((item) => ({ ...item, academicYearId: yearId }));
    if (!apply) {
      console.log(JSON.stringify({
        mode: "preview",
        database: ALLOWED_DATABASE,
        ignored,
        classCount: prepared.length,
        classes: prepared.map((item) => ({ name: item.name, gradeLevel: item.gradeLevel, code: item.code, concentration: item.concentrationName })),
      }));
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const before = await snapshot(tx, school.id, yearId);
      let created = 0;
      let existing = 0;
      for (const item of prepared) {
        const found = await tx.schoolClass.findUnique({
          where: { schoolId_academicYearId_name: { schoolId: school.id, academicYearId: yearId, name: item.name } },
          select: { id: true, gradeLevel: true, concentrationId: true, capacity: true, isActive: true, fase: true },
        });
        if (!found) {
          await tx.schoolClass.create({
            data: {
              schoolId: school.id,
              academicYearId: yearId,
              concentrationId: item.concentrationId,
              name: item.name,
              gradeLevel: item.gradeLevel,
              capacity: item.capacity,
              isActive: item.isActive,
            },
          });
          created += 1;
          continue;
        }
        if (
          found.gradeLevel !== item.gradeLevel
          || found.concentrationId !== item.concentrationId
          || found.capacity !== item.capacity
          || found.isActive !== true
          || found.fase !== null
        ) {
          throw new Error(`Kelas ${item.name} sudah ada dengan relasi berbeda. Transaksi dibatalkan.`);
        }
        existing += 1;
      }
      const after = await snapshot(tx, school.id, yearId);
      if (JSON.stringify(before.unchanged) !== JSON.stringify(after.unchanged)) {
        throw new Error("Data di luar kelas berubah. Transaksi dibatalkan.");
      }
      if (created + existing !== EXPECTED_CLASSES || after.yearClasses !== EXPECTED_CLASSES) {
        throw new Error("Jumlah kelas setelah penyimpanan tidak sesuai. Transaksi dibatalkan.");
      }
      const saved = await tx.schoolClass.findMany({
        where: { schoolId: school.id, academicYearId: yearId },
        select: {
          name: true,
          gradeLevel: true,
          capacity: true,
          isActive: true,
          fase: true,
          concentration: { select: { code: true, name: true, schoolId: true } },
          _count: { select: { students: true } },
        },
        orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
      });
      const expected = new Map(prepared.map((item) => [item.name, item]));
      if (saved.length !== EXPECTED_CLASSES) throw new Error("Daftar kelas tersimpan tidak lengkap. Transaksi dibatalkan.");
      for (const row of saved) {
        const plan = expected.get(row.name);
        if (!plan || row.gradeLevel !== plan.gradeLevel || row.concentration?.code !== plan.code || row.concentration.name !== plan.concentrationName) {
          throw new Error(`Relasi kelas ${row.name} tidak sesuai. Transaksi dibatalkan.`);
        }
        if (row.concentration.schoolId !== school.id || row._count.students !== 0 || row.capacity !== CLASS_CAPACITY || row.fase !== null || !row.isActive) {
          throw new Error(`Kelas ${row.name} membawa data di luar pembuatan kelas. Transaksi dibatalkan.`);
        }
      }
      return {
        created,
        existing,
        classes: saved.map((row) => ({
          name: row.name,
          gradeLevel: row.gradeLevel,
          code: row.concentration?.code ?? "",
          concentration: row.concentration?.name ?? "",
        })),
      };
    });
    console.log(JSON.stringify({ mode: "applied", database: ALLOWED_DATABASE, npsn: ALLOWED_NPSN, backup: backupPath, ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

async function snapshot(tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], schoolId: string, yearId: string) {
  const [years, periods, subjects, students, curricula, placements, grades, attendance, reports, fields, programs, concentrations, otherClasses, otherYearClasses, schoolCount, yearClasses] = await Promise.all([
    tx.academicYear.findMany({ where: { schoolId }, select: { name: true, startDate: true, endDate: true, isActive: true }, orderBy: { name: "asc" } }),
    tx.academicPeriod.findMany({ where: { schoolId }, select: { name: true, semesterKind: true, startDate: true, endDate: true, isActive: true }, orderBy: { startDate: "asc" } }),
    tx.subject.findMany({ where: { schoolId }, select: { code: true, name: true, category: true }, orderBy: { code: "asc" } }),
    tx.student.count({ where: { schoolId } }),
    tx.curriculum.count({ where: { schoolId } }),
    tx.curriculumPlacement.count({ where: { schoolId } }),
    tx.gradeFinalResult.count({ where: { schoolId } }),
    tx.attendanceRecord.count({ where: { schoolId } }),
    tx.reportCardSnapshot.count({ where: { schoolId } }),
    tx.expertiseField.count({ where: { schoolId } }),
    tx.expertiseProgram.count({ where: { schoolId } }),
    tx.expertiseConcentration.count({ where: { schoolId } }),
    tx.schoolClass.count({ where: { schoolId: { not: schoolId } } }),
    tx.schoolClass.count({ where: { schoolId, academicYearId: { not: yearId } } }),
    tx.school.count(),
    tx.schoolClass.count({ where: { schoolId, academicYearId: yearId } }),
  ]);
  return {
    yearClasses,
    unchanged: {
      years: years.map((item) => ({ name: item.name, start: day(item.startDate), end: day(item.endDate), isActive: item.isActive })),
      periods: periods.map((item) => ({ name: item.name, kind: item.semesterKind, start: day(item.startDate), end: day(item.endDate), isActive: item.isActive })),
      subjects,
      students,
      curricula,
      placements,
      grades,
      attendance,
      reports,
      fields,
      programs,
      concentrations,
      otherClasses,
      otherYearClasses,
      schoolCount,
    },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pembuatan kelas dibatalkan.");
  process.exitCode = 1;
});
