import type { ImportCommitDto, ImportPreviewDto, ImportPreviewRow, ImportRowStatus } from "@sims/shared";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import { writeAudit } from "../../lib/audit.ts";
import { AppError } from "../../lib/errors.ts";
import type { RequestMeta } from "../../lib/tenant.ts";
import { auditChange } from "./common.ts";
import {
  annotateStudentRows,
  classCountsOf,
  collectUnmapped,
  countStatus,
  readStudentWorkbook,
  reasonCountsOf,
  STUDENT_ROW_LIMIT,
  studentCreateData,
  studentProfileReady,
  type StudentWorkbook,
} from "./student-import.logic.ts";

type Kind = "teacher" | "student";
type Db = PrismaClient | Prisma.TransactionClient;

export type ImportSourceRow = {
  rowNumber: number;
  data: Record<string, string>;
};

const TEACHER_ROW_LIMIT = 500;
const STUDENT_HEADERS = ["nisn", "nama", "jenis_kelamin"] as const;

const HEADER_ALIASES: Record<string, string> = {
  nama: "nama",
  name: "nama",
  nama_lengkap: "nama",
  jenis_kelamin: "jenis_kelamin",
  jk: "jenis_kelamin",
  gender: "jenis_kelamin",
  telepon: "telepon",
  phone: "telepon",
  no_hp: "telepon",
  tempat_lahir: "tempat_lahir",
  tanggal_lahir: "tanggal_lahir",
  tgl_lahir: "tanggal_lahir",
  nip: "nip",
  nuptk: "nuptk",
  email: "email",
  nisn: "nisn",
  nis: "nis",
  kelas: "kelas",
  rombel: "kelas",
  l_p: "jenis_kelamin",
  nik: "nik",
  no_kk: "no_kk",
  nomor_kk: "no_kk",
  sekolah_asal: "sekolah_asal",
  agama: "agama",
  nama_ayah: "ayah",
  ayah: "ayah",
  nama_ibu: "ibu",
  ibu: "ibu",
  alamat: "alamat",
  keterangan: "keterangan",
  ket: "keterangan",
};

export const TEACHER_TEMPLATE = "nip,nama,jenis_kelamin,email,telepon,nuptk\n";
export const STUDENT_TEMPLATE = "\uFEFFNISN,NIS,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Kelas,Email,Telepon,NIK,No KK,Sekolah Asal,Agama,Nama Ayah,Nama Ibu,Alamat,Keterangan\n";

const STUDENT_COLUMNS = ["NISN", "NIS", "Nama Lengkap", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Kelas", "Email", "Telepon", "NIK", "No KK", "Sekolah Asal", "Agama", "Nama Ayah", "Nama Ibu", "Alamat", "Keterangan"] as const;

function normalizeHeader(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

type CsvLine = { line: number; cells: string[] };

export function parseCsv(text: string): { headers: string[]; rows: ImportSourceRow[] } {
  const source = text.replace(/^\uFEFF/, "");
  const table: CsvLine[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      table.push({ line: rowLine, cells: row });
      row = [];
      cell = "";
      line += 1;
      rowLine = line;
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    table.push({ line: rowLine, cells: row });
  }
  const filled = table.filter((entry) => entry.cells.some((column) => column !== ""));
  const header = filled.shift();
  if (!header) return { headers: [], rows: [] };
  const headers = header.cells.map(normalizeHeader);
  return {
    headers,
    rows: filled.map((entry) => {
      const data: Record<string, string> = {};
      headers.forEach((key, columnIndex) => {
        if (key && data[key] === undefined) data[key] = entry.cells[columnIndex] ?? "";
      });
      return { rowNumber: entry.line, data };
    }),
  };
}

function calendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = value.getMonth() + 1;
  const day = value.getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cellString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) {
    const text = dateOf(cell.text?.trim() ?? "");
    return text ?? calendarDate(value);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    const text = cell.text?.trim() ?? "";
    return text || String(value);
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if ("result" in value) {
      const result = value.result;
      if (result instanceof Date) return dateOf(cell.text?.trim() ?? "") ?? calendarDate(result);
      if (result == null) return "";
      if (typeof result === "number" && Number.isInteger(result)) return String(result);
      return String(result).trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
  }
  return (cell.text ?? "").trim();
}

async function readTabular(filename: string, buffer: Buffer): Promise<{ headers: string[]; rows: ImportSourceRow[] }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer.toString("utf8"));
  if (!lower.endsWith(".xlsx")) {
    throw new AppError(400, "VALIDATION_ERROR", "Berkas harus berformat XLSX atau CSV.");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "VALIDATION_ERROR", "Berkas Excel tidak dapat dibaca. Gunakan template XLSX atau CSV UTF-8.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = normalizeHeader(cellString(cell));
  });
  const rows: ImportSourceRow[] = [];
  sheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const data: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((key, column) => {
      if (!key || data[key] !== undefined) return;
      const value = cellString(excelRow.getCell(column));
      if (value) hasValue = true;
      data[key] = value;
    });
    if (hasValue) rows.push({ rowNumber, data });
  });
  return { headers: headers.filter((key) => Boolean(key)), rows };
}

export async function parseTabular(filename: string, buffer: Buffer): Promise<Record<string, string>[]> {
  return (await readTabular(filename, buffer)).rows.map((row) => row.data);
}

function genderOf(value: string): "LAKI_LAKI" | "PEREMPUAN" | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, " ");
  if (["l", "laki laki", "pria", "laki_laki"].includes(normalized)) return "LAKI_LAKI";
  if (["p", "perempuan", "wanita"].includes(normalized)) return "PEREMPUAN";
  return null;
}

function dateOf(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let iso = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = text;
  else {
    const match = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(text);
    if (!match) return null;
    iso = `${match[3]}-${match[2]}-${match[1]}`;
  }
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return iso;
}

function rowStatus(errors: string[]): ImportRowStatus {
  if (errors.length === 0) return "VALID";
  const duplicate = errors.every((error) => /duplikat|sudah digunakan/i.test(error));
  return duplicate ? "DUPLIKAT" : "GAGAL";
}

function previewRow(rowNumber: number, data: Record<string, string>, errors: string[]): ImportPreviewRow {
  return { rowNumber, data, errors, valid: errors.length === 0, status: rowStatus(errors) };
}

function summarize(rows: ImportPreviewRow[]): ImportPreviewDto {
  const validCount = rows.filter((row) => row.valid).length;
  const duplicateCount = rows.filter((row) => row.status === "DUPLIKAT").length;
  const failedCount = rows.filter((row) => !row.valid && row.status !== "DUPLIKAT").length;
  return {
    rows,
    totalCount: rows.length,
    validCount,
    invalidCount: rows.length - validCount,
    duplicateCount,
    failedCount,
  };
}

function assertStudentHeaders(headers: string[]): void {
  const present = new Set(headers);
  const missing = STUDENT_HEADERS.filter((key) => !present.has(key));
  if (missing.length > 0) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Format berkas tidak sesuai. Gunakan template siswa. Kolom wajib: NISN, Nama Lengkap, dan Jenis Kelamin.",
    );
  }
}

async function annotateTeachers(prisma: Db, schoolId: string, rows: ImportSourceRow[]): Promise<ImportPreviewRow[]> {
  const seen = new Set<string>();
  const annotated: ImportPreviewRow[] = [];
  for (const source of rows) {
    const data = source.data;
    const errors: string[] = [];
    const gender = genderOf(data.jenis_kelamin ?? "");
    if (!data.nama?.trim()) errors.push("Nama wajib diisi.");
    if (!gender) errors.push("Jenis kelamin harus L atau P.");
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("Email tidak valid.");
    const nip = data.nip?.trim() ?? "";
    if (nip && !/^\d{8,18}$/.test(nip)) errors.push("NIP harus 8–18 digit.");
    if (nip) {
      const key = `nip:${nip}`;
      if (seen.has(key)) errors.push("NIP duplikat di dalam berkas.");
      seen.add(key);
      const exists = await prisma.teacher.findFirst({ where: { schoolId, nip }, select: { id: true } });
      if (exists) errors.push("NIP sudah digunakan di sekolah ini.");
    }
    if (data.nuptk && !/^\d+$/.test(data.nuptk)) errors.push("NUPTK harus berupa angka.");
    annotated.push(previewRow(source.rowNumber, data, errors));
  }
  return annotated;
}

function studentSummary(rows: ImportPreviewRow[], workbook?: StudentWorkbook, profileReady = true, classMatches: ImportPreviewDto["classMatches"] = []): ImportPreviewDto {
  const createCount = countStatus(rows, "READY_CREATE");
  const updateCount = countStatus(rows, "READY_UPDATE");
  const duplicateCount = countStatus(rows, "DUPLICATE");
  const failedCount = countStatus(rows, "REJECTED");
  const reviewCount = countStatus(rows, "NEEDS_REVIEW");
  const skippedCount = countStatus(rows, "SKIPPED");
  return {
    rows,
    totalCount: rows.length,
    validCount: createCount + updateCount,
    invalidCount: rows.length - (createCount + updateCount),
    duplicateCount,
    failedCount,
    reviewCount,
    skippedCount,
    createCount,
    updateCount,
    unmappedColumns: collectUnmapped(rows, workbook?.unmappedColumns ?? []),
    sheets: workbook?.sheets ?? [],
    classCounts: classCountsOf(rows),
    classMatches,
    reasonCounts: reasonCountsOf(rows),
    profilePersistence: profileReady ? "available" : "unavailable",
  };
}

export async function previewImport(
  prisma: PrismaClient,
  schoolId: string,
  kind: Kind,
  filename: string,
  buffer: Buffer,
  academicYearId: string | null = null,
): Promise<ImportPreviewDto> {
  if (kind === "student" && filename.toLowerCase().endsWith(".xlsx")) {
    const workbook = await readStudentWorkbook(buffer);
    const profileReady = await studentProfileReady(prisma);
    const annotated = await annotateStudentRows(prisma, schoolId, workbook.rows, academicYearId, profileReady, workbook.sheets);
    return studentSummary(annotated.rows, workbook, profileReady, annotated.classMatches);
  }
  const parsed = await readTabular(filename, buffer);
  const limit = kind === "student" ? STUDENT_ROW_LIMIT : TEACHER_ROW_LIMIT;
  if (kind === "student") assertStudentHeaders(parsed.headers);
  if (parsed.rows.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Berkas tidak memiliki data.");
  if (parsed.rows.length > limit) {
    throw new AppError(400, "VALIDATION_ERROR", kind === "student" ? "Impor siswa dibatasi 4.000 baris." : "Impor dibatasi 500 baris.");
  }
  if (kind === "teacher") return summarize(await annotateTeachers(prisma, schoolId, parsed.rows));
  const profileReady = await studentProfileReady(prisma);
  const annotated = await annotateStudentRows(prisma, schoolId, parsed.rows, academicYearId, profileReady);
  return studentSummary(annotated.rows, undefined, profileReady, annotated.classMatches);
}

function commitCounts(rows: ImportPreviewRow[], created: number, updated = 0): ImportCommitDto {
  const duplicateCount = rows.filter((row) => row.status === "DUPLIKAT" || row.status === "DUPLICATE").length;
  const failedCount = rows.filter((row) => row.status === "GAGAL" || row.status === "REJECTED").length;
  const summary = studentSummary(rows);
  return {
    created,
    updated,
    skipped: rows.length - created - updated,
    rows,
    totalCount: rows.length,
    duplicateCount,
    failedCount,
    reviewCount: summary.reviewCount,
    skippedCount: summary.skippedCount,
  };
}

export async function commitImport(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  kind: Kind,
  rows: ImportSourceRow[],
  meta: RequestMeta,
  academicYearId: string | null = null,
): Promise<ImportCommitDto> {
  const limit = kind === "student" ? STUDENT_ROW_LIMIT : TEACHER_ROW_LIMIT;
  if (rows.length > limit) {
    throw new AppError(400, "VALIDATION_ERROR", kind === "student" ? "Impor siswa dibatasi 4.000 baris." : "Impor dibatasi 500 baris.");
  }
  if (kind === "teacher") {
    const annotated = await annotateTeachers(prisma, schoolId, rows);
    let created = 0;
    for (const row of annotated) {
      if (!row.valid) continue;
      const gender = genderOf(row.data.jenis_kelamin ?? "");
      if (!gender) continue;
      await prisma.teacher.create({
        data: {
          schoolId,
          nip: row.data.nip?.trim() || null,
          nuptk: row.data.nuptk?.trim() || null,
          name: row.data.nama?.trim() ?? "",
          gender,
          email: row.data.email?.trim() || null,
          phone: row.data.telepon?.trim() || null,
        },
      });
      created += 1;
    }
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: "TEACHERS_IMPORTED",
      entityType: "Teacher",
    });
    return commitCounts(annotated, created);
  }

  try {
    const profileReady = await studentProfileReady(prisma);
    return await prisma.$transaction(async (tx) => {
      const annotated = await annotateStudentRows(tx, schoolId, rows, academicYearId, profileReady);
      let created = 0;
      let updated = 0;
      for (const row of annotated.rows) {
        if (row.status === "READY_CREATE") {
          const classId = annotated.classIds.get(row.rowNumber);
          if (classId === undefined) {
            throw new AppError(400, "VALIDATION_ERROR", "Kelas tidak dapat dipetakan. Pratinjau ulang sebelum menyimpan.");
          }
          await tx.student.create({ data: studentCreateData(schoolId, row.data, classId, profileReady) });
          created += 1;
        } else if (row.status === "READY_UPDATE") {
          const change = annotated.updates.get(row.rowNumber);
          if (!change) {
            throw new AppError(400, "VALIDATION_ERROR", "Perubahan siswa tidak dapat dipetakan. Pratinjau ulang sebelum menyimpan.");
          }
          await tx.student.update({ where: { id: change.id }, data: change.data });
          updated += 1;
        }
      }
      const result = commitCounts(annotated.rows, created, updated);
      await writeAudit(tx, {
        schoolId,
        actorId: auth.userId,
        action: "STUDENTS_IMPORTED",
        entityType: "Student",
        metadata: {
          total: result.totalCount,
          created: result.created,
          updated: result.updated,
          duplicate: result.duplicateCount,
          failed: result.failedCount,
          review: result.reviewCount,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return result;
    }, { maxWait: 5000, timeout: 60000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "CONFLICT", "Data siswa berubah sejak pratinjau. Periksa ulang berkas sebelum menyimpan.");
    }
    throw error;
  }
}

export async function buildStudentTemplate(prisma: PrismaClient, schoolId: string, academicYearId: string | null): Promise<Buffer> {
  let classes: { name: string }[] = [];
  if (academicYearId) {
    const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId }, select: { id: true } });
    if (!year) throw new AppError(400, "VALIDATION_ERROR", "Tahun pelajaran tidak ditemukan di sekolah ini.");
    classes = await prisma.schoolClass.findMany({
      where: { schoolId, academicYearId, isActive: true },
      select: { name: true },
      orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    });
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Siswa");
  sheet.columns = [
    { width: 18 },
    { width: 16 },
    { width: 32 },
    { width: 16 },
    { width: 22 },
    { width: 18 },
    { width: 24 },
    { width: 28 },
    { width: 18 },
    { width: 20 },
    { width: 20 },
    { width: 28 },
    { width: 16 },
    { width: 24 },
    { width: 24 },
    { width: 36 },
    { width: 28 },
  ];
  sheet.addRow([...STUDENT_COLUMNS]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(2).numFmt = "@";
  sheet.getColumn(6).numFmt = "yyyy-mm-dd";
  sheet.getColumn(10).numFmt = "@";
  sheet.getColumn(11).numFmt = "@";
  sheet.getCell("J1").note = "Teks 16 digit. Kosongkan jika belum ada. Jangan membuat NIK.";
  sheet.getCell("K1").note = "Teks 16 digit. Nomor KK boleh sama untuk saudara.";
  sheet.getCell("A1").note = "Teks 10 digit. Jangan mengubah format sel agar nol di depan tetap ada.";
  sheet.getCell("B1").note = "Opsional. Kosongkan jika NIS belum ada. Jangan menyalin NISN ke kolom ini.";
  sheet.getCell("G1").note = "Isi dengan nama kelas yang sudah ada pada tahun pelajaran yang dipilih. Kosongkan jika siswa belum ditempatkan. Kelas baru tidak dibuat.";
  const validations = sheet as ExcelJS.Worksheet & {
    dataValidations: { add: (range: string, validation: ExcelJS.DataValidation) => void };
  };
  validations.dataValidations.add("D2:D1001", {
    type: "list",
    allowBlank: true,
    formulae: ['"L,P"'],
    showErrorMessage: true,
    errorTitle: "Jenis kelamin",
    error: "Isi L atau P.",
  });
  if (classes.length > 0) {
    const list = workbook.addWorksheet("Daftar Kelas");
    list.addRow(["Nama Kelas"]);
    list.getRow(1).font = { bold: true };
    for (const item of classes) {
      const cell = list.addRow([item.name]).getCell(1);
      cell.numFmt = "@";
    }
    validations.dataValidations.add("G2:G1001", {
      type: "list",
      allowBlank: true,
      formulae: [`'Daftar Kelas'!$A$2:$A$${classes.length + 1}`],
      showErrorMessage: true,
      errorTitle: "Kelas",
      error: "Pilih kelas yang sudah ada. Kelas baru tidak dibuat.",
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
