import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import {
  annotateStudentRows,
  dateOf,
  readStudentWorkbook,
  studentCreateData,
  studentProfileReady,
  type StudentSourceRow,
} from "../src/modules/academic/student-import.logic.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ALLOWED_DATABASE = "sims_sakti_qc";
const ALLOWED_NPSN = "10814092";
const ALLOWED_SCHOOL = "SMK PGRI Pasir Sakti";
const ALLOWED_YEAR = "2026/2027";
const SOURCE_FILE = "C:\\Users\\User\\Downloads\\DATA SISWA 2026-2027 RI - UPDATE - 15-11-26.xlsx";
const EXPECTED_CLASSES = 30;

const apply = process.argv.includes("--apply");
const backupPath = process.argv.find((item) => item.startsWith("--backup="))?.slice("--backup=".length) ?? "";

type PlannedStudent = {
  rowNumber: number;
  data: Record<string, string>;
  classId: string;
  className: string;
};

type DeferredStudent = { kelas: string; nama: string; alasan: string };

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  if (typeof value === "object" && "result" in value && value.result != null && typeof value.result !== "object") return String(value.result);
  return "";
}

function counts(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function genderOk(value: string): boolean {
  return ["l", "laki laki", "pria", "p", "perempuan", "wanita"].includes(value.trim().toLowerCase().replace(/[\s_-]+/g, " "));
}

async function mutasiMarkers(): Promise<Map<string, number>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(SOURCE_FILE) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  const markers = new Map<string, number>();
  workbook.worksheets.forEach((sheet) => {
    const name = sheet.name.replace(/\s+/g, " ").trim();
    let marker = Number.POSITIVE_INFINITY;
    const width = Math.max(sheet.columnCount, 4);
    for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
      for (let column = 1; column <= width; column += 1) {
        if (/mutasi/i.test(cellText(sheet.getRow(rowIndex).getCell(column)))) {
          marker = rowIndex;
          break;
        }
      }
      if (Number.isFinite(marker)) break;
    }
    markers.set(name, marker);
  });
  return markers;
}

function holdReason(
  data: Record<string, string>,
  nisnCount: Map<string, number>,
  nisCount: Map<string, number>,
  nikCount: Map<string, number>,
  classId: string | null | undefined,
  className: string | null,
): string | null {
  const nisn = data.nisn ?? "";
  const nis = data.nis ?? "";
  const nik = data.nik ?? "";
  const birth = data.tanggal_lahir ?? "";
  if (!nisn) return "NISN kosong";
  if (!/^\d{10}$/.test(nisn)) return "NISN tidak valid";
  if ((nisnCount.get(nisn) ?? 0) > 1) return "NISN duplikat";
  if (nis && (nisCount.get(nis) ?? 0) > 1) return "NIS duplikat";
  if (nis && !/^\d{1,32}$/.test(nis)) return "NIS tidak valid";
  if (/^\d{16}$/.test(nik) && (nikCount.get(nik) ?? 0) > 1) return "NIK duplikat";
  if (nik && !/^\d{16}$/.test(nik)) return "NIK tidak valid";
  if (birth && !dateOf(birth)) return "Tanggal lahir tidak valid";
  if (!genderOk(data.jenis_kelamin ?? "")) return "Jenis kelamin tidak valid";
  if (!classId || !className || className !== (data.kelas ?? "")) return "Kelas tidak cocok";
  if ((data.nama ?? "").length < 3 || (data.nama ?? "").length > 120) return "Nama tidak valid";
  return null;
}

async function main(): Promise<void> {
  if (apply && !backupPath) throw new Error("Backup wajib ada sebelum siswa disimpan.");
  if (apply) {
    const backup = statSync(backupPath);
    if (!backup.isFile() || backup.size < 100_000) throw new Error("Berkas backup tidak valid. Penyimpanan dihentikan.");
  }
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
  const url = new URL(sourceUrl);
  if ((url.hostname !== "localhost" && url.hostname !== "127.0.0.1") || databaseName(sourceUrl) !== ALLOWED_DATABASE) {
    throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
  }
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const current = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== ALLOWED_DATABASE) throw new Error("Identitas database tidak sesuai. Proses dihentikan.");
    const profileReady = await studentProfileReady(prisma);
    if (!profileReady) throw new Error("Kolom profil siswa belum siap. Penyimpanan dihentikan.");
    const school = await prisma.school.findUnique({ where: { npsn: ALLOWED_NPSN }, select: { id: true, name: true } });
    if (!school || school.name !== ALLOWED_SCHOOL) throw new Error("Identitas sekolah tidak sesuai. Proses dihentikan.");
    const year = await prisma.academicYear.findFirst({
      where: { schoolId: school.id, name: ALLOWED_YEAR, isActive: true },
      select: { id: true },
    });
    if (!year) throw new Error("Tahun pelajaran aktif tidak ditemukan. Proses dihentikan.");
    const classes = await prisma.schoolClass.findMany({
      where: { schoolId: school.id, academicYearId: year.id, isActive: true },
      select: { id: true, name: true },
    });
    if (classes.length !== EXPECTED_CLASSES) throw new Error("Jumlah kelas tidak sesuai. Penyimpanan dihentikan.");
    const classIdsByName = new Map(classes.map((item) => [item.name, item.id]));

    const markers = await mutasiMarkers();
    const workbook = await readStudentWorkbook(readFileSync(SOURCE_FILE));
    const annotated = await annotateStudentRows(prisma, school.id, workbook.rows as StudentSourceRow[], year.id, true, workbook.sheets);
    const population = annotated.rows.filter((row) => row.data.peran !== "sheet");
    const nisnCount = counts(population.flatMap((row) => (/^\d{10}$/.test(row.data.nisn ?? "") ? [row.data.nisn ?? ""] : [])));
    const nisCount = counts(population.flatMap((row) => {
      const nis = row.data.nis ?? "";
      return nis.length > 0 && nis.length <= 32 ? [nis] : [];
    }));
    const nikCount = counts(population.flatMap((row) => (/^\d{16}$/.test(row.data.nik ?? "") ? [row.data.nik ?? ""] : [])));

    const importable: PlannedStudent[] = [];
    const deferred: DeferredStudent[] = [];
    let mutasiNamed = 0;
    let rejectedRows = 0;
    for (const row of population) {
      const excelRow = row.rowNumber % 1000;
      const marker = markers.get(row.sheet ?? "") ?? Number.POSITIVE_INFINITY;
      const afterMutasi = excelRow >= marker;
      const named = row.status !== "SKIPPED" && row.status !== "REJECTED";
      if (afterMutasi) {
        if (named) mutasiNamed += 1;
        continue;
      }
      if (!named) {
        if (row.status === "REJECTED") rejectedRows += 1;
        continue;
      }
      const className = row.data.kelas ?? "";
      const classId = classIdsByName.get(className) ?? null;
      const annotatedClassId = annotated.classIds.get(row.rowNumber);
      if (annotatedClassId && annotatedClassId !== classId) {
        throw new Error(`Kelas ${className} tidak tunggal. Penyimpanan dihentikan.`);
      }
      const reason = holdReason(row.data, nisnCount, nisCount, nikCount, classId, classId ? className : null);
      if (reason) {
        deferred.push({ kelas: className || row.sheet || "", nama: row.data.nama ?? "", alasan: reason });
        continue;
      }
      if (row.status !== "READY_CREATE" && row.status !== "DUPLICATE" && row.status !== "READY_UPDATE") {
        deferred.push({ kelas: className, nama: row.data.nama ?? "", alasan: row.errors[0] || "Perlu pemeriksaan" });
        continue;
      }
      if (!classId) throw new Error(`Kelas ${className} tidak ditemukan. Penyimpanan dihentikan.`);
      importable.push({ rowNumber: row.rowNumber, data: row.data, classId, className });
    }

    const seenNisn = new Set<string>();
    for (const item of importable) {
      const nisn = item.data.nisn ?? "";
      if (seenNisn.has(nisn) || (nisnCount.get(nisn) ?? 0) !== 1) {
        throw new Error("Batch impor masih berisi NISN duplikat. Penyimpanan dihentikan.");
      }
      seenNisn.add(nisn);
    }
    const summary = {
      mode: apply ? "applied" : "preview",
      database: ALLOWED_DATABASE,
      classes: classes.length,
      importable: importable.length,
      deferred: deferred.length,
      mutasiNamed,
      rejectedRows,
      reasons: [...deferred.reduce((map, item) => map.set(item.alasan, (map.get(item.alasan) ?? 0) + 1), new Map<string, number>()).entries()],
    };
    if (!apply) {
      console.log(JSON.stringify({ ...summary, deferred }));
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await snapshot(tx, school.id, year.id);
      let created = 0;
      let existing = 0;
      for (const item of importable) {
        const payload = studentCreateData(school.id, item.data, item.classId, true);
        const classRow = await tx.schoolClass.findFirst({
          where: { id: item.classId, schoolId: school.id, academicYearId: year.id },
          select: { id: true, name: true },
        });
        if (!classRow || classRow.name !== item.className || classRow.name !== item.data.kelas) {
          throw new Error(`Kelas ${item.className} tidak sesuai. Transaksi dibatalkan.`);
        }
        const found = await tx.student.findUnique({
          where: { nisn: payload.nisn },
          select: { id: true, schoolId: true, nisn: true, nis: true, name: true, gender: true, classId: true },
        });
        if (found) {
          if (found.schoolId !== school.id || found.name !== payload.name || found.gender !== payload.gender || found.classId !== payload.classId || (found.nis ?? null) !== payload.nis) {
            throw new Error(`NISN ${payload.nisn} sudah tersimpan dengan identitas berbeda. Transaksi dibatalkan.`);
          }
          existing += 1;
          continue;
        }
        if (payload.nis) {
          const nisOwner = await tx.student.findFirst({ where: { schoolId: school.id, nis: payload.nis }, select: { id: true } });
          if (nisOwner) throw new Error("NIS sudah digunakan siswa lain. Transaksi dibatalkan.");
        }
        if (payload.nik) {
          const nikOwner = await tx.student.findFirst({ where: { nik: payload.nik }, select: { id: true } });
          if (nikOwner) throw new Error("NIK sudah digunakan siswa lain. Transaksi dibatalkan.");
        }
        await tx.student.create({ data: payload });
        created += 1;
      }
      const after = await snapshot(tx, school.id, year.id);
      if (JSON.stringify(before.unchanged) !== JSON.stringify(after.unchanged)) {
        throw new Error("Data di luar siswa berubah. Transaksi dibatalkan.");
      }
      if (after.students !== before.students + created) throw new Error("Jumlah siswa tidak sesuai. Transaksi dibatalkan.");
      const perClass = await tx.schoolClass.findMany({
        where: { schoolId: school.id, academicYearId: year.id },
        select: { name: true, _count: { select: { students: true } } },
        orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
      });
      return {
        created,
        existing,
        students: after.students,
        perClass: perClass.map((item) => ({ kelas: item.name, siswa: item._count.students })),
      };
    }, { maxWait: 10_000, timeout: 120_000 });
    console.log(JSON.stringify({ ...summary, ...result, backup: backupPath }));
  } finally {
    await prisma.$disconnect();
  }
}

async function snapshot(tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], schoolId: string, yearId: string) {
  const [years, periods, subjects, classes, curricula, placements, grades, attendance, reports, fields, programs, concentrations, users, roles, teachers, schoolCount, students] = await Promise.all([
    tx.academicYear.findMany({ where: { schoolId }, select: { name: true, startDate: true, endDate: true, isActive: true }, orderBy: { name: "asc" } }),
    tx.academicPeriod.findMany({ where: { schoolId }, select: { name: true, semesterKind: true, startDate: true, endDate: true, isActive: true }, orderBy: { startDate: "asc" } }),
    tx.subject.findMany({ where: { schoolId }, select: { code: true, name: true, category: true }, orderBy: { code: "asc" } }),
    tx.schoolClass.findMany({
      where: { schoolId },
      select: { id: true, name: true, gradeLevel: true, academicYearId: true, concentrationId: true, capacity: true, isActive: true, fase: true },
      orderBy: { name: "asc" },
    }),
    tx.curriculum.count({ where: { schoolId } }),
    tx.curriculumPlacement.count({ where: { schoolId } }),
    tx.gradeFinalResult.count({ where: { schoolId } }),
    tx.attendanceRecord.count({ where: { schoolId } }),
    tx.reportCardSnapshot.count({ where: { schoolId } }),
    tx.expertiseField.count({ where: { schoolId } }),
    tx.expertiseProgram.count({ where: { schoolId } }),
    tx.expertiseConcentration.count({ where: { schoolId } }),
    tx.user.count(),
    tx.userRole.count(),
    tx.teacher.count({ where: { schoolId } }),
    tx.school.count(),
    tx.student.count({ where: { schoolId } }),
  ]);
  return {
    students,
    unchanged: {
      years: years.map((item) => ({ name: item.name, start: item.startDate.toISOString().slice(0, 10), end: item.endDate.toISOString().slice(0, 10), isActive: item.isActive })),
      periods: periods.map((item) => ({ name: item.name, kind: item.semesterKind, start: item.startDate.toISOString().slice(0, 10), end: item.endDate.toISOString().slice(0, 10), isActive: item.isActive })),
      subjects,
      classes,
      curricula,
      placements,
      grades,
      attendance,
      reports,
      fields,
      programs,
      concentrations,
      users,
      roles,
      teachers,
      schoolCount,
      yearId,
    },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Impor siswa dibatalkan.");
  process.exitCode = 1;
});
