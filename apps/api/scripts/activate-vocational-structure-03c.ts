import dotenv from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  expertiseConcentrations,
  expertiseFields,
  expertisePrograms,
} from "../src/modules/academic/vocational-master.catalog.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ALLOWED_DATABASE = "sims_sakti_qc";
const ALLOWED_NPSN = "10814092";
const ALLOWED_SCHOOL = "SMK PGRI Pasir Sakti";

const APPROVED_FIELDS: Array<[string, string]> = [
  ["2", "Teknologi Manufaktur dan Rekayasa"],
  ["4", "Teknologi Informasi"],
  ["8", "Bisnis dan Manajemen"],
  ["9", "Pariwisata"],
];
const APPROVED_PROGRAMS: Array<[string, string, string]> = [
  ["2.2", "Teknik Otomotif", "2"],
  ["4.2", "Teknik Jaringan Komputer dan Telekomunikasi", "4"],
  ["8.1", "Pemasaran", "8"],
  ["8.3", "Akuntansi dan Keuangan Lembaga", "8"],
  ["9.2", "Perhotelan", "9"],
];
const APPROVED_CONCENTRATIONS: Array<[string, string, string]> = [
  ["2.2.2", "Teknik Sepeda Motor", "2.2"],
  ["4.2.1", "Teknik Komputer dan Jaringan", "4.2"],
  ["8.1.2", "Bisnis Retail", "8.1"],
  ["8.3.3", "Akuntansi", "8.3"],
  ["9.2.1", "Perhotelan", "9.2"],
];

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function sameList(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function assertApprovedCatalog(): void {
  const fields = expertiseFields.map((item) => `${item.code}|${item.name}`);
  const programs = expertisePrograms.map((item) => `${item.code}|${item.name}|${item.fieldCode}`);
  const opened = expertiseConcentrations.filter((item) => item.schoolTrack).map((item) => `${item.code}|${item.name}|${item.programCode}`);
  if (!sameList(fields, APPROVED_FIELDS.map((item) => item.join("|")))) throw new Error("Katalog bidang tidak sesuai persetujuan.");
  if (!sameList(programs, APPROVED_PROGRAMS.map((item) => item.join("|")))) throw new Error("Katalog program tidak sesuai persetujuan.");
  if (!sameList(opened, APPROVED_CONCENTRATIONS.map((item) => item.join("|")))) throw new Error("Katalog konsentrasi tidak sesuai persetujuan.");
}

async function main(): Promise<void> {
  assertApprovedCatalog();
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
  const url = new URL(sourceUrl);
  const host = url.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("Aktivasi hanya untuk PostgreSQL lokal.");
  if (databaseName(sourceUrl) !== ALLOWED_DATABASE) throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const current = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== ALLOWED_DATABASE) throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
    const school = await prisma.school.findUnique({
      where: { npsn: ALLOWED_NPSN },
      select: { id: true, name: true, npsn: true },
    });
    if (!school || school.name !== ALLOWED_SCHOOL || school.npsn !== ALLOWED_NPSN) {
      throw new Error("Identitas sekolah tidak sesuai. Proses dihentikan.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await snapshot(tx, school.id);
      const fieldIds = new Map<string, string>();
      let fieldsCreated = 0;
      let programsCreated = 0;
      let concentrationsCreated = 0;
      for (const [code, name] of APPROVED_FIELDS) {
        const found = await tx.expertiseField.findUnique({ where: { schoolId_code: { schoolId: school.id, code } } });
        if (!found) {
          const created = await tx.expertiseField.create({ data: { schoolId: school.id, code, name } });
          fieldIds.set(code, created.id);
          fieldsCreated += 1;
        } else if (found.name !== name) {
          throw new Error(`Bidang ${code} sudah ada dengan nama berbeda. Transaksi dibatalkan.`);
        } else {
          fieldIds.set(code, found.id);
        }
      }
      const programIds = new Map<string, string>();
      for (const [code, name, fieldCode] of APPROVED_PROGRAMS) {
        const fieldId = fieldIds.get(fieldCode);
        if (!fieldId) throw new Error("Bidang induk tidak tersedia. Transaksi dibatalkan.");
        const found = await tx.expertiseProgram.findUnique({ where: { schoolId_code: { schoolId: school.id, code } } });
        if (!found) {
          const created = await tx.expertiseProgram.create({ data: { schoolId: school.id, fieldId, code, name } });
          programIds.set(code, created.id);
          programsCreated += 1;
        } else if (found.name !== name || found.fieldId !== fieldId) {
          throw new Error(`Program ${code} tidak sesuai hierarki. Transaksi dibatalkan.`);
        } else {
          programIds.set(code, found.id);
        }
      }
      for (const [code, name, programCode] of APPROVED_CONCENTRATIONS) {
        const programId = programIds.get(programCode);
        if (!programId) throw new Error("Program induk tidak tersedia. Transaksi dibatalkan.");
        const found = await tx.expertiseConcentration.findUnique({ where: { schoolId_code: { schoolId: school.id, code } } });
        if (!found) {
          await tx.expertiseConcentration.create({ data: { schoolId: school.id, programId, code, name } });
          concentrationsCreated += 1;
        } else if (found.name !== name || found.programId !== programId) {
          throw new Error(`Konsentrasi ${code} tidak sesuai hierarki. Transaksi dibatalkan.`);
        }
      }
      const after = await snapshot(tx, school.id);
      if (JSON.stringify(before.frozen) !== JSON.stringify(after.frozen)) {
        throw new Error("Data di luar struktur kejuruan berubah. Transaksi dibatalkan.");
      }
      if (after.fields !== 4 || after.programs !== 5 || after.concentrations !== 5) {
        throw new Error("Jumlah struktur kejuruan tidak sesuai. Transaksi dibatalkan.");
      }
      if (!sameList(after.hierarchy, [
        "2.2>2",
        "4.2>4",
        "8.1>8",
        "8.3>8",
        "9.2>9",
        "2.2.2>2.2",
        "4.2.1>4.2",
        "8.1.2>8.1",
        "8.3.3>8.3",
        "9.2.1>9.2",
      ])) throw new Error("Hierarki tidak sesuai. Transaksi dibatalkan.");
      const closed = await tx.expertiseConcentration.count({
        where: { schoolId: school.id, code: { in: ["4.2.2", "4.2.3", "8.1.1"] } },
      });
      if (closed !== 0) throw new Error("Konsentrasi yang tidak disetujui ikut tersimpan. Transaksi dibatalkan.");
      return { before: before.counts, after: after.counts, fieldsCreated, programsCreated, concentrationsCreated, hierarchy: after.hierarchy };
    });
    console.log(JSON.stringify({ database: ALLOWED_DATABASE, npsn: ALLOWED_NPSN, ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

async function snapshot(tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], schoolId: string) {
  const [years, periods, subjects, classes, students, curricula, placements, grades, attendance, reports, fields, programs, concentrations, otherFields, otherPrograms, otherConcentrations, schoolCount] = await Promise.all([
    tx.academicYear.findMany({ where: { schoolId }, select: { name: true, startDate: true, endDate: true, isActive: true }, orderBy: { name: "asc" } }),
    tx.academicPeriod.findMany({ where: { schoolId }, select: { name: true, semesterKind: true, startDate: true, endDate: true, isActive: true }, orderBy: { startDate: "asc" } }),
    tx.subject.findMany({ where: { schoolId }, select: { code: true, name: true, category: true }, orderBy: { code: "asc" } }),
    tx.schoolClass.count({ where: { schoolId } }),
    tx.student.count({ where: { schoolId } }),
    tx.curriculum.count({ where: { schoolId } }),
    tx.curriculumPlacement.count({ where: { schoolId } }),
    tx.gradeFinalResult.count({ where: { schoolId } }),
    tx.attendanceRecord.count({ where: { schoolId } }),
    tx.reportCardSnapshot.count({ where: { schoolId } }),
    tx.expertiseField.count({ where: { schoolId } }),
    tx.expertiseProgram.count({ where: { schoolId } }),
    tx.expertiseConcentration.count({ where: { schoolId } }),
    tx.expertiseField.count({ where: { schoolId: { not: schoolId } } }),
    tx.expertiseProgram.count({ where: { schoolId: { not: schoolId } } }),
    tx.expertiseConcentration.count({ where: { schoolId: { not: schoolId } } }),
    tx.school.count(),
  ]);
  const links = await tx.expertiseProgram.findMany({
    where: { schoolId },
    select: { code: true, field: { select: { code: true } } },
    orderBy: { code: "asc" },
  });
  const concentrationLinks = await tx.expertiseConcentration.findMany({
    where: { schoolId },
    select: { code: true, program: { select: { code: true } } },
    orderBy: { code: "asc" },
  });
  const hierarchy = [
    ...links.map((item) => `${item.code}>${item.field.code}`),
    ...concentrationLinks.map((item) => `${item.code}>${item.program.code}`),
  ];
  const frozen = {
    years: years.map((item) => ({ name: item.name, start: day(item.startDate), end: day(item.endDate), isActive: item.isActive })),
    periods: periods.map((item) => ({ name: item.name, kind: item.semesterKind, start: day(item.startDate), end: day(item.endDate), isActive: item.isActive })),
    subjects,
    classes,
    students,
    curricula,
    placements,
    grades,
    attendance,
    reports,
    otherFields,
    otherPrograms,
    otherConcentrations,
    schoolCount,
  };
  return {
    frozen,
    fields,
    programs,
    concentrations,
    hierarchy,
    counts: { fields, programs, concentrations, subjects: subjects.length, classes, students, curricula, placements, grades, attendance, reports, otherFields, otherPrograms, otherConcentrations, schoolCount },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Aktivasi dibatalkan.");
  process.exitCode = 1;
});
