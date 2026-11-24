import type { ImportClassCount, ImportClassMatch, ImportPreviewRow, ImportReasonCount, ImportRowStatus, ImportSheetSummary } from "@sims/shared";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.ts";
import { parseDateOnly } from "./common.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export type StudentSourceRow = {
  rowNumber: number;
  data: Record<string, string>;
};

export const STUDENT_ROW_LIMIT = 4000;
const SHEET_STRIDE = 1000;

const HEADER_ALIASES: Record<string, string> = {
  nama: "nama",
  name: "nama",
  nama_lengkap: "nama",
  nama_siswa: "nama",
  jenis_kelamin: "jenis_kelamin",
  jk: "jenis_kelamin",
  gender: "jenis_kelamin",
  l_p: "jenis_kelamin",
  lp: "jenis_kelamin",
  telepon: "telepon",
  phone: "telepon",
  no_hp: "telepon",
  tempat_lahir: "tempat_lahir",
  tanggal_lahir: "tanggal_lahir",
  tgl_lahir: "tanggal_lahir",
  nisn: "nisn",
  nis: "nis",
  kelas: "kelas",
  rombel: "kelas",
  nik: "nik",
  no_kk: "no_kk",
  nomor_kk: "no_kk",
  kk: "no_kk",
  no_kartu_keluarga: "no_kk",
  sekolah_asal: "sekolah_asal",
  asal_sekolah: "sekolah_asal",
  agama: "agama",
  ayah: "ayah",
  nama_ayah: "ayah",
  ibu: "ibu",
  nama_ibu: "ibu",
  alamat: "alamat",
  ket: "keterangan",
  keterangan: "keterangan",
  keterangan_siswa: "keterangan",
  no: "no",
  tuhun: "tahun",
  tahun: "tahun",
  no_ijazah: "no_ijazah",
  nomor_ijazah: "no_ijazah",
  email: "email",
};

const STORED_KEYS = new Set([
  "nisn",
  "nis",
  "nama",
  "jenis_kelamin",
  "tempat_lahir",
  "tanggal_lahir",
  "kelas",
  "email",
  "telepon",
  "nik",
  "no_kk",
  "sekolah_asal",
  "agama",
  "ayah",
  "ibu",
  "alamat",
  "keterangan",
]);

const RETAINED_UNMAPPED = new Set(["tahun", "no_ijazah"]);

const SKIP_SHEET = /rekap|mutasi|statistik|peringkat|agama|asal sekolah|pindah|pndh|global|desember|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|^sheet\d*$|^us$/i;

export type StudentWorkbook = {
  sheets: ImportSheetSummary[];
  unmappedColumns: string[];
  rows: StudentSourceRow[];
};

type StoredStudent = {
  id: string;
  schoolId: string;
  nisn: string;
  nis: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  birthPlace: string | null;
  birthDate: Date | null;
  email: string | null;
  phone: string | null;
  classId: string | null;
  fatherName: string | null;
  motherName: string | null;
  nik: string | null;
  familyCardNo: string | null;
  originSchool: string | null;
  religion: string | null;
  address: string | null;
  studentNote: string | null;
};

export type StudentFill = {
  nis?: string;
  birthPlace?: string;
  birthDate?: Date;
  email?: string;
  phone?: string;
  fatherName?: string;
  motherName?: string;
  nik?: string;
  familyCardNo?: string;
  originSchool?: string;
  religion?: string;
  address?: string;
  studentNote?: string;
};

export type StudentUpdate = {
  id: string;
  data: StudentFill;
};

function spaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function headerKey(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/[./]+/g, " ").replace(/\s+/g, "_").replace(/_+/g, "_");
  return HEADER_ALIASES[key] ?? null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoFromDate(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return isoFromDate(utc);
}

export function dateOf(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let iso = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) iso = text.slice(0, 10);
  else {
    const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
    if (!match) return null;
    const dayText = match[1] ?? "";
    const monthText = match[2] ?? "";
    const yearText = match[3] ?? "";
    iso = `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
  }
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return iso;
}

function cellString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return isoFromDate(value);
  if (typeof value === "number") {
    const format = String(cell.numFmt ?? "").toLowerCase();
    if (/[dy]/.test(format)) return serialToIso(value) ?? "";
    if (Number.isSafeInteger(value)) return String(value);
    return "";
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if ("result" in value) {
      const result = value.result;
      if (result instanceof Date) return isoFromDate(result);
      if (result == null || typeof result === "object") return "";
      if (typeof result === "number") {
        return Number.isSafeInteger(result) ? String(result) : "";
      }
      return String(result).trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
  }
  return "";
}

function sheetDisposition(name: string): "historical" | "skipped" | null {
  const label = name.replace(/\s+/g, " ").trim();
  if (/mutasi|pindah|pndh|global/i.test(label)) return "historical";
  if (SKIP_SHEET.test(label)) return "skipped";
  return null;
}

function isSkippedSheet(name: string): boolean {
  return sheetDisposition(name) !== null;
}

function classFromSheet(name: string): string | null {
  const label = name.replace(/\s+/g, " ").trim();
  if (/^(x|xi|xii|vii|viii|ix)\b/i.test(label)) return label;
  return null;
}

function sheetCells(row: ExcelJS.Row, width: number): string[] {
  const cells: string[] = [];
  for (let column = 1; column <= width; column += 1) cells.push(cellString(row.getCell(column)));
  return cells;
}

function isHeaderRow(cells: string[]): boolean {
  const keys = new Set(cells.map(headerKey).filter((key): key is string => Boolean(key)));
  return keys.has("nama") && (keys.has("nisn") || keys.has("jenis_kelamin") || keys.has("nik") || keys.has("nis"));
}

type HeaderMap = { keys: Array<string | null>; unmapped: string[] };

function mapHeaders(primary: string[], secondary: string[] | null): HeaderMap {
  const width = Math.max(primary.length, secondary?.length ?? 0);
  const keys: Array<string | null> = [];
  const unmapped: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < width; index += 1) {
    const child = secondary ? headerKey(secondary[index] ?? "") : null;
    const parent = headerKey(primary[index] ?? "");
    const key = child && child !== "no" ? child : parent;
    const raw = spaces(secondary?.[index] || primary[index] || "");
    if (!key) {
      if (raw) unmapped.push(raw);
      keys.push(null);
      continue;
    }
    if (key === "no") {
      keys.push("no");
      continue;
    }
    if (seen.has(key)) {
      keys.push(null);
      continue;
    }
    seen.add(key);
    keys.push(key);
    if (RETAINED_UNMAPPED.has(key)) unmapped.push(raw || key);
  }
  return { keys, unmapped };
}

function skippedSheetReason(name: string): string {
  if (/mutasi|pindah|pndh|global/i.test(name)) return "Sheet mutasi atau data historis tidak dipakai sebagai daftar siswa aktif.";
  if (/rekap|statistik|peringkat|agama|asal|desember|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|^us$|sheet/i.test(name)) {
    return "Sheet rekap atau statistik tidak dipakai sebagai daftar siswa aktif.";
  }
  return "Sheet di luar ruang lingkup impor siswa aktif.";
}

export async function readStudentWorkbook(buffer: Buffer): Promise<StudentWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "VALIDATION_ERROR", "Berkas Excel tidak dapat dibaca. Gunakan template XLSX atau CSV UTF-8.");
  }
  const sheets: ImportSheetSummary[] = [];
  const rows: StudentSourceRow[] = [];
  const unmapped = new Set<string>();
  let studentRows = 0;
  workbook.worksheets.forEach((sheet, sheetIndex) => {
    const name = sheet.name.replace(/\s+/g, " ").trim();
    const rowNumberBase = sheetIndex * SHEET_STRIDE;
    const disposition = sheetDisposition(name);
    if (disposition) {
      sheets.push({ name, role: disposition, reason: skippedSheetReason(name), rowCount: 0 });
      rows.push({
        rowNumber: rowNumberBase + 1,
        data: { sheet: name, peran: "sheet", kelas: "" },
      });
      return;
    }
    const width = Math.max(sheet.columnCount, 1);
    let headerAt = 0;
    let primary: string[] = [];
    for (let rowIndex = 1; rowIndex <= Math.min(sheet.rowCount, 20); rowIndex += 1) {
      const cells = sheetCells(sheet.getRow(rowIndex), width);
      if (isHeaderRow(cells)) {
        headerAt = rowIndex;
        primary = cells;
        break;
      }
    }
    if (!headerAt) {
      const reason = "Sheet tidak berisi daftar siswa.";
      sheets.push({ name, role: "skipped", reason, rowCount: 0 });
      rows.push({ rowNumber: rowNumberBase + 1, data: { sheet: name, peran: "sheet", kelas: "" } });
      return;
    }
    const next = sheetCells(sheet.getRow(headerAt + 1), width);
    const secondary = isHeaderRow(next) || next.some((cell) => headerKey(cell) === "ayah" || headerKey(cell) === "ibu") ? next : null;
    const mapped = mapHeaders(primary, secondary);
    for (const column of mapped.unmapped) unmapped.add(column);
    const dataStart = headerAt + (secondary ? 2 : 1);
    const sheetClass = classFromSheet(name);
    let count = 0;
    for (let rowIndex = dataStart; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const cells = sheetCells(sheet.getRow(rowIndex), width);
      if (cells.every((cell) => cell === "")) continue;
      const data: Record<string, string> = { sheet: name };
      const original: Record<string, string> = {};
      cells.forEach((cell, index) => {
        const key = mapped.keys[index];
        if (key === "no") return;
        if (!key || data[key] !== undefined) {
          const rawHeader = spaces((secondary?.[index] || primary[index] || "")).trim();
          if (!key && rawHeader && cell) data[`lain:${rawHeader}`] = cell;
          return;
        }
        original[key] = cell;
        data[key] = cell;
      });
      if (!data.kelas && sheetClass) data.kelas = sheetClass;
      data.sumber = JSON.stringify(original);
      rows.push({ rowNumber: rowNumberBase + rowIndex, data });
      count += 1;
      studentRows += 1;
    }
    sheets.push({
      name,
      role: "students",
      reason: sheetClass ? `Sheet kelas ${sheetClass}.` : "Sheet daftar siswa.",
      rowCount: count,
    });
  });
  if (studentRows > STUDENT_ROW_LIMIT) {
    throw new AppError(400, "VALIDATION_ERROR", "Impor siswa dibatasi 4.000 baris.");
  }
  if (rows.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Berkas tidak memiliki data.");
  return { sheets, unmappedColumns: [...unmapped], rows };
}

function genderOf(value: string): "LAKI_LAKI" | "PEREMPUAN" | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["l", "laki laki", "pria"].includes(normalized)) return "LAKI_LAKI";
  if (["p", "perempuan", "wanita"].includes(normalized)) return "PEREMPUAN";
  return null;
}

function identifier(value: string): string {
  return value.trim().replace(/^'+/, "").replace(/\s+/g, "");
}

function studentPayload(raw: Record<string, string>): Record<string, string> {
  const birth = dateOf(raw.tanggal_lahir ?? "");
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("lain:") || key === "sumber" || key === "sheet" || key === "peran") data[key] = value;
  }
  data.sheet = raw.sheet ?? "";
  data.peran = raw.peran ?? "";
  data.nisn = identifier(raw.nisn ?? "");
  data.nis = identifier(raw.nis ?? "");
  data.nama = spaces(raw.nama ?? "");
  data.jenis_kelamin = spaces(raw.jenis_kelamin ?? "");
  data.tempat_lahir = spaces(raw.tempat_lahir ?? "");
  data.tanggal_lahir = birth ?? spaces(raw.tanggal_lahir ?? "");
  data.kelas = spaces(raw.kelas ?? "");
  data.email = spaces(raw.email ?? "").toLowerCase();
  data.telepon = spaces(raw.telepon ?? "");
  data.nik = identifier(raw.nik ?? "");
  data.no_kk = identifier(raw.no_kk ?? "");
  data.sekolah_asal = spaces(raw.sekolah_asal ?? "");
  data.agama = spaces(raw.agama ?? "");
  data.ayah = spaces(raw.ayah ?? "");
  data.ibu = spaces(raw.ibu ?? "");
  data.alamat = spaces(raw.alamat ?? "");
  data.keterangan = spaces(raw.keterangan ?? "");
  if (raw.tahun) data.tahun = spaces(raw.tahun);
  if (raw.no_ijazah) data.no_ijazah = spaces(raw.no_ijazah);
  if (raw.sumber) data.sumber = raw.sumber;
  if ((raw.tanggal_lahir ?? "").trim() && birth && birth !== (raw.tanggal_lahir ?? "").trim()) {
    data.asli_tanggal_lahir = (raw.tanggal_lahir ?? "").trim();
  }
  return data;
}

function rowOf(rowNumber: number, data: Record<string, string>, errors: string[], status: ImportRowStatus): ImportPreviewRow {
  return {
    rowNumber,
    sheet: data.sheet || undefined,
    data,
    errors,
    valid: status === "READY_CREATE" || status === "READY_UPDATE",
    status,
  };
}

function sameText(stored: string | null, incoming: string): boolean {
  return spaces(stored ?? "") === incoming;
}

type ClassRecord = { id: string; name: string; gradeLevel: number };
type ClassIndex = { map: Map<string, string>; records: ClassRecord[] };

const CLASS_TOKEN_ALIAS: Record<string, string> = {
  tjkj: "tjkt",
  tkj: "tjkt",
  tjk: "tjkt",
  to: "tsm",
  pht: "perhotelan",
  ph: "perhotelan",
  ak: "akuntansi",
  akun: "akuntansi",
  akl: "akuntansi",
  pm: "pemasaran",
  bdp: "pemasaran",
  bd: "pemasaran",
};

export function classLookupKeys(name: string): string[] {
  const compact = name.replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID");
  const aliased = compact.split(" ").map((token) => CLASS_TOKEN_ALIAS[token] ?? token).join(" ");
  return compact === aliased ? [compact] : [compact, aliased];
}

export function gradeLevelOfClass(name: string): number | null {
  const token = name.replace(/\s+/g, " ").trim().split(" ")[0]?.toUpperCase() ?? "";
  if (token === "XIII") return 13;
  if (token === "XII") return 12;
  if (token === "XI") return 11;
  if (token === "X") return 10;
  if (token === "IX") return 9;
  return null;
}

function rememberClassKey(map: Map<string, string>, key: string, id: string) {
  if (!map.has(key)) map.set(key, id);
  else if (map.get(key) !== id) map.set(key, "");
}

async function loadClassIndex(prisma: Db, schoolId: string, academicYearId: string | null): Promise<ClassIndex | null> {
  if (!academicYearId) return null;
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId }, select: { id: true } });
  if (!year) throw new AppError(400, "VALIDATION_ERROR", "Tahun pelajaran tidak ditemukan di sekolah ini.");
  const records = await prisma.schoolClass.findMany({
    where: { schoolId, academicYearId, isActive: true },
    select: { id: true, name: true, gradeLevel: true },
  });
  const map = new Map<string, string>();
  for (const item of records) {
    for (const key of classLookupKeys(item.name)) rememberClassKey(map, key, item.id);
  }
  return { map, records };
}

export function resolveClassLabel(index: ClassIndex, label: string): { status: "MATCHED" | "MISSING" | "AMBIGUOUS"; classId: string | null; className: string | null } {
  const ids = new Set<string>();
  let ambiguous = false;
  for (const key of classLookupKeys(label)) {
    if (!index.map.has(key)) continue;
    const id = index.map.get(key) ?? "";
    if (!id) ambiguous = true;
    else ids.add(id);
  }
  if (ambiguous || ids.size > 1) return { status: "AMBIGUOUS", classId: null, className: null };
  const classId = [...ids][0] ?? null;
  if (!classId) return { status: "MISSING", classId: null, className: null };
  return { status: "MATCHED", classId, className: index.records.find((item) => item.id === classId)?.name ?? null };
}

export function buildClassMatches(sheets: ImportSheetSummary[], rows: ImportPreviewRow[], index: ClassIndex | null): ImportClassMatch[] {
  const labels = new Map<string, string>();
  const addLabel = (value: string) => {
    const sourceName = value.replace(/\s+/g, " ").trim();
    if (gradeLevelOfClass(sourceName) === null) return;
    const key = sourceName.toLocaleLowerCase("id-ID");
    if (!labels.has(key)) labels.set(key, sourceName);
  };
  for (const sheet of sheets) {
    if (sheet.role === "students") addLabel(sheet.name);
  }
  for (const row of rows) {
    if (row.data.peran === "sheet") continue;
    addLabel(row.data.kelas || "");
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "SKIPPED" || row.data.peran === "sheet") continue;
    const key = (row.data.kelas || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...labels.entries()].map(([key, sourceName]) => {
    const resolved = index ? resolveClassLabel(index, sourceName) : { status: "MISSING" as const, classId: null, className: null };
    return {
      sheet: sourceName,
      sourceName,
      status: index ? resolved.status : "MISSING",
      classId: resolved.classId,
      className: resolved.className,
      gradeLevel: gradeLevelOfClass(sourceName),
      studentCount: counts.get(key) ?? 0,
    };
  });
}

function consider(
  stored: string | null,
  incoming: string,
  label: string,
  review: string[],
  apply: (value: string) => void,
) {
  if (!incoming) return;
  if (!stored) {
    apply(incoming);
    return;
  }
  if (!sameText(stored, incoming)) review.push(`${label} berbeda dari data tersimpan dan tidak ditimpa.`);
}

const baseStudentSelect = {
  id: true,
  schoolId: true,
  nisn: true,
  nis: true,
  name: true,
  gender: true,
  birthPlace: true,
  birthDate: true,
  email: true,
  phone: true,
  classId: true,
} as const;

const profileStudentSelect = {
  fatherName: true,
  motherName: true,
  nik: true,
  familyCardNo: true,
  originSchool: true,
  religion: true,
  address: true,
  studentNote: true,
} as const;

export async function studentProfileReady(prisma: Db): Promise<boolean> {
  try {
    await prisma.student.findFirst({ select: { nik: true } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") return false;
    throw error;
  }
}

function toStored(row: {
  id: string;
  schoolId: string;
  nisn: string;
  nis: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  birthPlace: string | null;
  birthDate: Date | null;
  email: string | null;
  phone: string | null;
  classId: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  nik?: string | null;
  familyCardNo?: string | null;
  originSchool?: string | null;
  religion?: string | null;
  address?: string | null;
  studentNote?: string | null;
}): StoredStudent {
  return {
    id: row.id,
    schoolId: row.schoolId,
    nisn: row.nisn,
    nis: row.nis,
    name: row.name,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate,
    email: row.email,
    phone: row.phone,
    classId: row.classId,
    fatherName: row.fatherName ?? null,
    motherName: row.motherName ?? null,
    nik: row.nik ?? null,
    familyCardNo: row.familyCardNo ?? null,
    originSchool: row.originSchool ?? null,
    religion: row.religion ?? null,
    address: row.address ?? null,
    studentNote: row.studentNote ?? null,
  };
}

export async function annotateStudentRows(
  prisma: Db,
  schoolId: string,
  rows: StudentSourceRow[],
  academicYearId: string | null,
  profileReady = true,
  sheets: ImportSheetSummary[] = [],
): Promise<{ rows: ImportPreviewRow[]; classIds: Map<number, string | null>; updates: Map<number, StudentUpdate>; classMatches: ImportClassMatch[] }> {
  const prepared = rows.map((source) => ({ rowNumber: source.rowNumber, data: studentPayload(source.data) }));
  const nisnKeys = [...new Set(prepared.flatMap((row) => {
    const nisn = row.data.nisn ?? "";
    return /^\d{10}$/.test(nisn) ? [nisn] : [];
  }))];
  const nisKeys = [...new Set(prepared.flatMap((row) => {
    const nis = row.data.nis ?? "";
    return nis.length > 0 && nis.length <= 32 ? [nis] : [];
  }))];
  const nikKeys = profileReady
    ? [...new Set(prepared.flatMap((row) => {
      const nik = row.data.nik ?? "";
      return /^\d{16}$/.test(nik) ? [nik] : [];
    }))]
    : [];
  const select = profileReady ? { ...baseStudentSelect, ...profileStudentSelect } : baseStudentSelect;
  const [byNisn, byNis, byNik, classMap] = await Promise.all([
    nisnKeys.length
      ? prisma.student.findMany({ where: { nisn: { in: nisnKeys } }, select })
      : Promise.resolve([]),
    nisKeys.length
      ? prisma.student.findMany({ where: { schoolId, nis: { in: nisKeys } }, select })
      : Promise.resolve([]),
    nikKeys.length
      ? prisma.student.findMany({ where: { nik: { in: nikKeys } }, select })
      : Promise.resolve([]),
    loadClassIndex(prisma, schoolId, academicYearId),
  ]);
  const nisnUsed = new Map(byNisn.map((row) => [row.nisn, toStored(row)]));
  const nisUsed = new Map(byNis.flatMap((row) => (row.nis ? [[row.nis, toStored(row)] as const] : [])));
  const nikUsed = new Map(byNik.flatMap((row) => {
    const stored = toStored(row);
    return stored.nik ? [[stored.nik, stored] as const] : [];
  }));
  const historyIds = [...new Set([...byNisn, ...byNis].filter((row) => row.schoolId === schoolId).map((row) => row.id))];
  const history = new Set<string>();
  if (historyIds.length > 0) {
    const [grades, attendance, reports, daily] = await Promise.all([
      prisma.gradeFinalResult.findMany({ where: { schoolId, studentId: { in: historyIds } }, select: { studentId: true }, distinct: ["studentId"] }),
      prisma.attendanceRecord.findMany({ where: { schoolId, studentId: { in: historyIds } }, select: { studentId: true }, distinct: ["studentId"] }),
      prisma.reportCardWorkflow.findMany({ where: { schoolId, studentId: { in: historyIds } }, select: { studentId: true }, distinct: ["studentId"] }),
      prisma.dailyAttendanceRecord.findMany({ where: { schoolId, studentId: { in: historyIds } }, select: { studentId: true }, distinct: ["studentId"] }),
    ]);
    for (const row of [...grades, ...attendance, ...reports, ...daily]) history.add(row.studentId);
  }
  const seenNisn = new Set<string>();
  const seenNis = new Set<string>();
  const seenNik = new Set<string>();
  const classIds = new Map<number, string | null>();
  const updates = new Map<number, StudentUpdate>();
  const annotated = prepared.map((source) => {
    const data = source.data;
    if (data.peran === "sheet") {
      const reason = isSkippedSheet(data.sheet ?? "")
        ? skippedSheetReason(data.sheet ?? "")
        : "Sheet tidak berisi daftar siswa.";
      return rowOf(source.rowNumber, data, [reason], "SKIPPED");
    }
    const name = data.nama ?? "";
    const nisn = data.nisn ?? "";
    const nik = data.nik ?? "";
    const looksEmpty = !name && !nisn && !nik && !(data.nis ?? "");
    if (looksEmpty || /^(jumlah|total|rekap|keterangan)$/i.test(name)) {
      return rowOf(source.rowNumber, data, ["Baris bukan data siswa."], "SKIPPED");
    }
    const rejected: string[] = [];
    const review: string[] = [];
    const duplicate: string[] = [];
    if (!name) rejected.push("Nama wajib diisi.");
    else if (name.length < 3) rejected.push("Nama minimal 3 karakter.");
    else if (name.length > 120) rejected.push("Nama maksimal 120 karakter.");
    const gender = genderOf(data.jenis_kelamin ?? "");
    if (!gender) review.push("Jenis kelamin harus L atau P.");
    if ((data.tempat_lahir ?? "").length > 80) review.push("Tempat lahir maksimal 80 karakter.");
    if ((data.tanggal_lahir ?? "").length > 0 && !dateOf(data.tanggal_lahir ?? "")) review.push("Tanggal lahir tidak valid.");
    if ((data.email ?? "").length > 0 && ((data.email ?? "").length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? ""))) {
      review.push("Email tidak valid.");
    }
    if ((data.telepon ?? "").length > 32) review.push("Telepon maksimal 32 karakter.");
    if ((data.ayah ?? "").length > 120) review.push("Nama ayah maksimal 120 karakter.");
    if ((data.ibu ?? "").length > 120) review.push("Nama ibu maksimal 120 karakter.");
    if ((data.sekolah_asal ?? "").length > 160) review.push("Sekolah asal maksimal 160 karakter.");
    if ((data.agama ?? "").length > 40) review.push("Agama maksimal 40 karakter.");
    if ((data.alamat ?? "").length > 300) review.push("Alamat maksimal 300 karakter.");
    if ((data.keterangan ?? "").length > 300) review.push("Keterangan maksimal 300 karakter.");
    if (!nisn) review.push("NISN kosong. NISN tidak dibuat otomatis.");
    else if (!/^\d{10}$/.test(nisn)) review.push("NISN tidak valid. Nilai asli dipertahankan dan tidak diperkirakan.");
    if (nik && !/^\d{16}$/.test(nik)) review.push("NIK tidak valid. NIK tidak dibuat otomatis.");
    const kk = data.no_kk ?? "";
    if (kk && !/^\d{16}$/.test(kk)) review.push("Nomor KK tidak valid.");
    const nis = data.nis ?? "";
    if (nis.length > 32) review.push("NIS maksimal 32 karakter.");

    let existing: StoredStudent | null = null;
    if (/^\d{10}$/.test(nisn)) {
      if (seenNisn.has(nisn)) duplicate.push("NISN duplikat di dalam berkas.");
      seenNisn.add(nisn);
      const found = nisnUsed.get(nisn);
      if (found && found.schoolId !== schoolId) duplicate.push("NISN sudah terdaftar di sekolah lain. Data sekolah lain tidak diubah.");
      else if (found) existing = found;
    }
    if (nis && nis.length <= 32) {
      if (seenNis.has(nis)) duplicate.push("NIS duplikat di dalam berkas.");
      seenNis.add(nis);
      const found = nisUsed.get(nis);
      if (found && (!existing || found.id !== existing.id)) {
        review.push("NIS sudah digunakan siswa lain di sekolah ini.");
      }
    }
    if (/^\d{16}$/.test(nik)) {
      if (seenNik.has(nik)) duplicate.push("NIK duplikat di dalam berkas.");
      seenNik.add(nik);
      const found = nikUsed.get(nik);
      if (found && found.schoolId !== schoolId) duplicate.push("NIK sudah terdaftar di sekolah lain. Data sekolah lain tidak diubah.");
      else if (found && (!existing || found.id !== existing.id)) duplicate.push("NIK duplikat dengan siswa lain.");
    }

    let classId: string | null | undefined;
    const className = data.kelas ?? "";
    if (className) {
      if (!classMap) review.push("Pilih tahun pelajaran agar kelas dapat dipetakan. Kelas baru tidak dibuat.");
      else {
        const resolved = resolveClassLabel(classMap, className);
        if (resolved.status === "MISSING") review.push("Kelas tidak ditemukan pada tahun pelajaran ini. Pembuatan kelas menunggu konfirmasi.");
        else if (resolved.status === "AMBIGUOUS") review.push("Nama kelas tidak unik pada tahun pelajaran ini. Kelas baru tidak dibuat.");
        else {
          classId = resolved.classId;
          if (resolved.className) data.kelas_master = resolved.className;
        }
      }
    } else classId = null;

    if (rejected.length > 0) return rowOf(source.rowNumber, data, rejected, "REJECTED");
    if (duplicate.length > 0) return rowOf(source.rowNumber, data, [...duplicate, ...review], "DUPLICATE");

    if (existing) {
      if (!sameText(existing.name, name)) review.push("Nama berbeda dari data tersimpan. Identitas tidak ditimpa.");
      if (gender && existing.gender !== gender) review.push("Jenis kelamin berbeda dari data tersimpan. Identitas tidak ditimpa.");
      if (existing.nis && nis && existing.nis !== nis) review.push("NIS berbeda dari data tersimpan dan tidak ditimpa.");
      if (classId && existing.classId && classId !== existing.classId) {
        const historyNote = history.has(existing.id) ? " Siswa sudah memiliki histori akademik." : "";
        review.push(`Penempatan kelas tidak diubah melalui impor identitas.${historyNote}`);
      } else if (classId && !existing.classId && history.has(existing.id)) {
        review.push("Penempatan kelas tidak diubah karena siswa sudah memiliki histori akademik.");
      }
      if (review.length > 0) return rowOf(source.rowNumber, data, review, "NEEDS_REVIEW");
      const fill: StudentFill = {};
      consider(existing.birthPlace, data.tempat_lahir ?? "", "Tempat lahir", review, (value) => { fill.birthPlace = value; });
      const birth = dateOf(data.tanggal_lahir ?? "");
      if (birth) {
        const stored = existing.birthDate ? isoFromDate(existing.birthDate) : "";
        if (!stored) fill.birthDate = parseDateOnly(birth);
        else if (stored !== birth) review.push("Tanggal lahir berbeda dari data tersimpan dan tidak ditimpa.");
      }
      consider(existing.email, data.email ?? "", "Email", review, (value) => { fill.email = value; });
      consider(existing.phone, data.telepon ?? "", "Telepon", review, (value) => { fill.phone = value; });
      if (profileReady) {
        consider(existing.fatherName, data.ayah ?? "", "Nama ayah", review, (value) => { fill.fatherName = value; });
        consider(existing.motherName, data.ibu ?? "", "Nama ibu", review, (value) => { fill.motherName = value; });
        if (/^\d{16}$/.test(nik)) consider(existing.nik, nik, "NIK", review, (value) => { fill.nik = value; });
        if (/^\d{16}$/.test(kk)) consider(existing.familyCardNo, kk, "Nomor KK", review, (value) => { fill.familyCardNo = value; });
        consider(existing.originSchool, data.sekolah_asal ?? "", "Sekolah asal", review, (value) => { fill.originSchool = value; });
        consider(existing.religion, data.agama ?? "", "Agama", review, (value) => { fill.religion = value; });
        consider(existing.address, data.alamat ?? "", "Alamat", review, (value) => { fill.address = value; });
        consider(existing.studentNote, data.keterangan ?? "", "Keterangan", review, (value) => { fill.studentNote = value; });
      } else if ([data.ayah, data.ibu, nik, kk, data.sekolah_asal, data.agama, data.alamat, data.keterangan].some((value) => (value ?? "").length > 0)) {
        review.push("Data orang tua, NIK, nomor KK, sekolah asal, agama, alamat, atau keterangan belum dapat disimpan sebelum pembaruan database disetujui.");
      }
      if (!existing.nis && nis) fill.nis = nis;
      if (review.length > 0) return rowOf(source.rowNumber, data, review, "NEEDS_REVIEW");
      if (Object.keys(fill).length === 0) {
        return rowOf(source.rowNumber, data, ["Siswa sudah terdaftar. Tidak ada perubahan aman."], "DUPLICATE");
      }
      updates.set(source.rowNumber, { id: existing.id, data: fill });
      return rowOf(source.rowNumber, data, ["Perubahan mengisi data yang masih kosong. Data terisi dan penempatan kelas tidak ditimpa."], "READY_UPDATE");
    }

    if (!profileReady && [data.ayah, data.ibu, nik, kk, data.sekolah_asal, data.agama, data.alamat, data.keterangan].some((value) => (value ?? "").length > 0)) {
      review.push("Data orang tua, NIK, nomor KK, sekolah asal, agama, alamat, atau keterangan belum dapat disimpan sebelum pembaruan database disetujui.");
    }
    if (review.length > 0) return rowOf(source.rowNumber, data, review, "NEEDS_REVIEW");
    if (!gender || !/^\d{10}$/.test(nisn) || classId === undefined) {
      return rowOf(source.rowNumber, data, ["Data belum lengkap untuk siswa baru."], "NEEDS_REVIEW");
    }
    classIds.set(source.rowNumber, classId);
    return rowOf(source.rowNumber, data, ["Siswa baru dengan pemetaan yang valid."], "READY_CREATE");
  });
  return { rows: annotated, classIds, updates, classMatches: buildClassMatches(sheets, annotated, classMap) };
}

export function studentCreateData(schoolId: string, data: Record<string, string>, classId: string | null, profileReady = true) {
  const gender = genderOf(data.jenis_kelamin ?? "");
  const birth = dateOf(data.tanggal_lahir ?? "");
  if (!gender || !/^\d{10}$/.test(data.nisn ?? "")) {
    throw new AppError(400, "VALIDATION_ERROR", "Baris siswa tidak lagi valid. Pratinjau ulang sebelum menyimpan.");
  }
  const base = {
    schoolId,
    nisn: data.nisn ?? "",
    nis: (data.nis ?? "").trim() || null,
    name: data.nama ?? "",
    gender,
    birthPlace: data.tempat_lahir || null,
    birthDate: birth ? parseDateOnly(birth) : null,
    email: data.email || null,
    phone: data.telepon || null,
    classId,
    isActive: true,
  };
  if (!profileReady) return base;
  return {
    ...base,
    fatherName: data.ayah || null,
    motherName: data.ibu || null,
    nik: /^\d{16}$/.test(data.nik ?? "") ? data.nik : null,
    familyCardNo: /^\d{16}$/.test(data.no_kk ?? "") ? data.no_kk : null,
    originSchool: data.sekolah_asal || null,
    religion: data.agama || null,
    address: data.alamat || null,
    studentNote: data.keterangan || null,
  };
}

export function collectUnmapped(rows: ImportPreviewRow[], workbookColumns: string[]): string[] {
  const found = new Set(workbookColumns);
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (key.startsWith("lain:")) found.add(key.slice(5));
    }
  }
  for (const key of [...found]) {
    if (STORED_KEYS.has(headerKey(key) ?? key)) found.delete(key);
  }
  return [...found];
}

export function reasonCountsOf(rows: ImportPreviewRow[]): ImportReasonCount[] {
  const counts = new Map<string, ImportReasonCount>();
  for (const row of rows) {
    const status = row.status ?? (row.valid ? "READY_CREATE" : "REJECTED");
    const reason = row.errors[0] || "Tanpa alasan";
    const key = `${status}\u0000${reason}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { status, reason, count: 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count);
}

export function classCountsOf(rows: ImportPreviewRow[]): ImportClassCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "SKIPPED" || row.data.peran === "sheet") continue;
    const name = row.data.kelas || "Belum dipetakan";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([className, count]) => ({ className, count }));
}

export function countStatus(rows: ImportPreviewRow[], status: ImportRowStatus): number {
  return rows.filter((row) => row.status === status).length;
}
