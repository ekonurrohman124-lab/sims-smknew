import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { ImportCommitDto, ImportPreviewDto } from "@sims/shared";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const PASSWORD = "RahasiaUji!2026";
const SCHOOL_FILE = "C:\\Users\\User\\Downloads\\DATA SISWA 2026-2027 RI - UPDATE - 15-11-26.xlsx";
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: resolve(apiRoot, ".env") });

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL tidak tersedia.");
if (BANNED_DATABASES.has(TARGET_DATABASE) || databaseName(sourceUrl) === TARGET_DATABASE) {
  throw new Error("Target uji tidak boleh memakai database aktif.");
}
const isolated = new URL(sourceUrl);
isolated.pathname = `/${TARGET_DATABASE}`;
const isolatedUrl = isolated.toString();
if (databaseName(isolatedUrl) !== TARGET_DATABASE || BANNED_DATABASES.has(databaseName(isolatedUrl))) {
  throw new Error("URL database uji tidak sah.");
}
process.env.DATABASE_URL = isolatedUrl;
process.env.NODE_ENV = "development";

type AppModule = typeof import("../src/app.ts");
type AccessModule = typeof import("../src/modules/access/assignments.ts");
type PasswordModule = typeof import("../src/lib/password.ts");

let prisma: PrismaClient;
let app: FastifyInstance;
let grantAssignment: AccessModule["grantAssignment"];
let hashPassword: PasswordModule["hashPassword"];

async function assertDatabase(client: PrismaClient, expected: string): Promise<void> {
  const rows = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const name = rows[0]?.name;
  if (name !== expected || BANNED_DATABASES.has(name ?? "")) {
    throw new Error("Pengujian berhenti karena database bukan target yang diminta.");
  }
}

async function ensureDatabase(): Promise<void> {
  const adminUrl = new URL(isolatedUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await assertDatabase(admin, "postgres");
    const found = await admin.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${TARGET_DATABASE}
    `;
    if (found.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TARGET_DATABASE}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

async function wipeOwnedRows(): Promise<void> {
  await assertDatabase(prisma, TARGET_DATABASE);
  const schools = await prisma.school.findMany({
    where: { npsn: { in: ["90110071", "90110072"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.gradeFinalResult.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teachingAssignment.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.subject.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@import01.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

function multipart(filename: string, content: Buffer, yearId?: string) {
  const boundary = "----sims-smart-import-71";
  const chunks: Buffer[] = [];
  if (yearId) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="academicYearId"\r\n\r\n${yearId}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  chunks.push(content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(chunks) };
}

async function schoolWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const main = workbook.addWorksheet("X TKJ 2");
  main.addRow(["DAFTAR NAMA SISWA X TKJ 2"]);
  main.addRow(["SMK UJI IMPOR"]);
  main.addRow(["TAHUN PELAJARAN 2026/2027"]);
  main.addRow([]);
  main.addRow(["NO", "NIS", "NISN", "NAMA SISWA", "TEMPAT LAHIR", "TGL LAHIR", "TUHUN", "L/P", "NIK", "NO KK", "SEKOLAH ASAL", "AGAMA", "NAMA ORANG TUA", "NAMA ORANG TUA", "ALAMAT", "NO IJAZAH", "KET"]);
  main.addRow(["NO", "NIS", "NISN", "NAMA SISWA", "TEMPAT LAHIR", "TGL LAHIR", "TUHUN", "L/P", "NIK", "NO KK", "SEKOLAH ASAL", "AGAMA", "AYAH", "IBU", "ALAMAT", "NO IJAZAH", "KET"]);
  const addMain = (values: Array<string | number | Date | null>) => {
    const row = main.addRow(values);
    row.getCell(3).numFmt = "@";
    row.getCell(9).numFmt = "@";
    row.getCell(10).numFmt = "@";
    if (typeof values[2] === "string") row.getCell(3).value = values[2];
    if (typeof values[8] === "string") row.getCell(9).value = values[8];
    return row;
  };
  for (let index = 1; index <= 51; index += 1) {
    const nisn = index === 1 ? "0710001001" : String(7100001000 + index);
    addMain([
      index,
      index === 2 ? "" : `NIS${index}`,
      nisn,
      `Siswa Uji ${index}`,
      "Lampung",
      index === 1 ? new Date(Date.UTC(2010, 0, 4)) : "04/01/2010",
      2010,
      index % 2 === 0 ? "P" : "L",
      index === 1 ? "3171010101010001" : "",
      index === 1 ? "3171010101010099" : "",
      index === 1 ? "SMP Uji" : "",
      index === 1 ? "Islam" : "",
      index === 1 ? "Ayah Uji" : "",
      index === 1 ? "Ibu Uji" : "",
      index === 1 ? "Jalan Uji" : "",
      index === 1 ? "IJZ-1" : "",
      index === 1 ? "Catatan uji" : "",
    ]);
  }
  addMain([52, "", "", "Siswa Tanpa NISN", "Lampung", "04/01/2010", 2010, "L", "", "", "", "", "", "", "", "", ""]);
  addMain([53, "NIS53", "0710001001", "Siswa NISN Ganda", "Lampung", "04/01/2010", 2010, "L", "", "", "", "", "", "", "", "", ""]);
  addMain([54, "NIS54", "7100001054", "Siswa NIK Ganda", "Lampung", "04/01/2010", 2010, "L", "3171010101010001", "", "", "", "", "", "", "", ""]);
  addMain([55, "", "7100001992", "Siswa Isi Kosong", "Lampung", "04/01/2010", 2010, "L", "", "", "", "", "Ayah Baru", "", "", "", ""]);
  addMain([56, "NIS56", "7100001993", "Siswa Nama Berbeda", "Lampung", "04/01/2010", 2010, "L", "", "", "", "", "", "", "", "", ""]);
  addMain([57, "NIS57", "7100001999", "Siswa Sekolah Lain", "Lampung", "04/01/2010", 2010, "L", "", "", "", "", "", "", "", "", ""]);
  addMain([58, "", "", "JUMLAH", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

  const move = workbook.addWorksheet("XI TKJ 2");
  move.addRow(["NO", "NISN", "NAMA SISWA", "L/P"]);
  move.addRow([1, "7100001991", "Siswa Histori", "L"]);
  move.addRow([2, "7100001801", "Siswa Kelas Dua", "P"]);

  const missing = workbook.addWorksheet("XII TKJ 9");
  missing.addRow(["NO", "NISN", "NAMA SISWA", "L/P"]);
  missing.addRow([1, "7100001802", "Siswa Kelas Hilang", "L"]);

  const ambiguous = workbook.addWorksheet("Catatan");
  ambiguous.addRow(["NISN", "Nama Lengkap", "Jenis Kelamin", "Kelas"]);
  ambiguous.addRow(["7100001803", "Siswa Kelas Ganda", "L", "X TKJ 1"]);

  const recap = workbook.addWorksheet("REKAP");
  recap.addRow(["REKAP SISWA", 100]);
  const mutation = workbook.addWorksheet("MUTASI MASUK");
  mutation.addRow(["NO", "NISN", "NAMA SISWA", "L/P", "Tgl Mutasi"]);
  mutation.addRow([1, "7100001888", "Bukan Siswa Aktif", "L", "01/01/2026"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("impor siswa cerdas", { concurrency: 1 }, () => {
  before(async () => {
    await ensureDatabase();
    execFileSync("npx prisma migrate deploy", {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolatedUrl, NODE_ENV: "development" },
      stdio: "inherit",
      shell: true,
    });
    prisma = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
    await assertDatabase(prisma, TARGET_DATABASE);
    const access = await import("../src/modules/access/assignments.ts");
    const passwords = await import("../src/lib/password.ts");
    const application = (await import("../src/app.ts")) as AppModule;
    grantAssignment = access.grantAssignment;
    hashPassword = passwords.hashPassword;
    await access.ensureRoles(prisma);
    app = await application.buildApp({ prisma });
    await app.ready();
  });

  beforeEach(async () => {
    await wipeOwnedRows();
  });

  after(async () => {
    await wipeOwnedRows();
    await app.close();
    await prisma.$disconnect();
  });

  it("membaca berkas multi-sheet tanpa menimpa identitas, kelas, atau histori", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Impor Cerdas", npsn: "90110071" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Impor Lain", npsn: "90110072" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const home = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 2", gradeLevel: 10 } });
    const next = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "XI TKJ 2", gradeLevel: 11 } });
    await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10 } });
    await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "x tkj 1", gradeLevel: 10 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Impor", gender: "LAKI_LAKI" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "IMP", name: "Impor", category: "KEJURUAN" } });
    const teaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: home.id, academicPeriodId: period.id },
    });
    const fill = await prisma.student.create({
      data: { schoolId: school.id, classId: home.id, nisn: "7100001992", nis: "LAMA-92", name: "Siswa Isi Kosong", gender: "LAKI_LAKI" },
    });
    const conflict = await prisma.student.create({
      data: { schoolId: school.id, classId: home.id, nisn: "7100001993", nis: "LAMA-93", name: "Siswa Tersimpan", gender: "LAKI_LAKI", birthPlace: "Metro" },
    });
    const history = await prisma.student.create({
      data: { schoolId: school.id, classId: home.id, nisn: "7100001991", nis: "LAMA-91", name: "Siswa Histori", gender: "LAKI_LAKI", birthPlace: "Lampung" },
    });
    const grade = await prisma.gradeFinalResult.create({
      data: { schoolId: school.id, teachingAssignmentId: teaching.id, studentId: history.id, score: "80.0000", formula: "tetap", detail: { source: "uji" }, savedById: teacher.id },
    });
    const outsider = await prisma.student.create({
      data: { schoolId: other.id, nisn: "7100001999", name: "Siswa Sekolah Lain", gender: "PEREMPUAN", birthPlace: "Tetap" },
    });
    const admin = await prisma.user.create({ data: { email: "admin@import01.uji.local", name: "Admin Impor", passwordHash: await hashPassword(PASSWORD) } });
    const guru = await prisma.user.create({ data: { email: "guru@import01.uji.local", name: "Guru Impor", passwordHash: await hashPassword(PASSWORD) } });
    const neighbor = await prisma.user.create({ data: { email: "lain@import01.uji.local", name: "Admin Lain", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    const adminToken = await tokenFor(admin.email);
    const file = await schoolWorkbook();
    const body = multipart("siswa-sekolah.xlsx", file, year.id);
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${await tokenFor(guru.email)}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    assert.equal(denied.statusCode, 403);
    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${await tokenFor(neighbor.email)}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    assert.equal(foreign.statusCode, 403);

    const before = await prisma.student.count({ where: { schoolId: school.id } });
    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${adminToken}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    assert.equal(preview.statusCode, 200);
    const previewBody = JSON.parse(preview.body) as ImportPreviewDto;
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), before);
    assert.ok((previewBody.createCount ?? 0) > 50);
    assert.equal(previewBody.createCount, 52);
    assert.equal(previewBody.updateCount, 1);
    assert.equal(previewBody.sheets?.find((sheet) => sheet.name === "REKAP")?.role, "skipped");
    assert.equal(previewBody.sheets?.find((sheet) => sheet.name === "MUTASI MASUK")?.role, "historical");
    assert.equal(previewBody.sheets?.filter((sheet) => sheet.role === "students").length, 4);
    assert.ok((previewBody.unmappedColumns ?? []).some((column) => /ijazah|tahun|tuhun/i.test(column)));
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Tanpa NISN")?.status, "NEEDS_REVIEW");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa NISN Ganda")?.status, "DUPLICATE");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa NIK Ganda")?.status, "DUPLICATE");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Hilang")?.status, "NEEDS_REVIEW");
    assert.match(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Hilang")?.errors.join(" ") ?? "", /tidak ditemukan/);
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Ganda")?.status, "NEEDS_REVIEW");
    assert.match(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Ganda")?.errors.join(" ") ?? "", /tidak unik/);
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Nama Berbeda")?.status, "NEEDS_REVIEW");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Histori")?.status, "NEEDS_REVIEW");
    assert.match(previewBody.rows.find((row) => row.data.nama === "Siswa Histori")?.errors.join(" ") ?? "", /histori akademik/);
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Sekolah Lain")?.status, "DUPLICATE");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "JUMLAH")?.status, "SKIPPED");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Isi Kosong")?.status, "READY_UPDATE");
    const classRow = previewBody.classCounts?.find((item) => item.className === "X TKJ 2");
    assert.ok((classRow?.count ?? 0) > 50);
    assert.equal(previewBody.classMatches?.find((item) => item.sourceName === "X TKJ 2")?.status, "MATCHED");
    assert.equal(previewBody.classMatches?.find((item) => item.sourceName === "XII TKJ 9")?.status, "MISSING");
    assert.equal(previewBody.classMatches?.find((item) => item.sourceName === "X TKJ 1")?.status, "AMBIGUOUS");
    assert.equal(previewBody.classMatches?.some((item) => item.sourceName === "Catatan"), false);

    const commit = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/commit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { academicYearId: year.id, rows: previewBody.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })) },
    });
    assert.equal(commit.statusCode, 200);
    const commitBody = JSON.parse(commit.body) as ImportCommitDto;
    assert.equal(commitBody.created, 52);
    assert.equal(commitBody.updated, 1);
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 55);
    assert.equal(await prisma.student.count({ where: { schoolId: other.id } }), 1);
    assert.equal(await prisma.schoolClass.count({ where: { schoolId: school.id, name: "XII TKJ 9" } }), 0);

    const created = await prisma.student.findUniqueOrThrow({ where: { nisn: "0710001001" } });
    assert.equal(created.schoolId, school.id);
    assert.equal(created.classId, home.id);
    assert.equal(created.nis, "NIS1");
    assert.equal(created.birthDate?.toISOString().slice(0, 10), "2010-01-04");
    assert.equal(created.fatherName, "Ayah Uji");
    assert.equal(created.motherName, "Ibu Uji");
    assert.equal(created.nik, "3171010101010001");
    assert.equal(created.familyCardNo, "3171010101010099");
    assert.equal(created.originSchool, "SMP Uji");
    assert.equal(created.religion, "Islam");
    assert.equal(created.address, "Jalan Uji");
    assert.equal(created.studentNote, "Catatan uji");
    const blankNis = await prisma.student.findUniqueOrThrow({ where: { nisn: "7100001002" } });
    assert.equal(blankNis.nis, null);
    const moved = await prisma.student.findUniqueOrThrow({ where: { id: history.id } });
    assert.equal(moved.classId, home.id);
    assert.equal(moved.name, "Siswa Histori");
    assert.equal(moved.birthPlace, "Lampung");
    const keptGrade = await prisma.gradeFinalResult.findUniqueOrThrow({ where: { id: grade.id } });
    assert.equal(keptGrade.score.toString().startsWith("80"), true);
    assert.equal(keptGrade.studentId, history.id);
    const keptConflict = await prisma.student.findUniqueOrThrow({ where: { id: conflict.id } });
    assert.equal(keptConflict.name, "Siswa Tersimpan");
    assert.equal(keptConflict.birthPlace, "Metro");
    assert.equal(keptConflict.classId, home.id);
    const filled = await prisma.student.findUniqueOrThrow({ where: { id: fill.id } });
    assert.equal(filled.fatherName, "Ayah Baru");
    assert.equal(filled.classId, home.id);
    assert.equal(filled.nis, "LAMA-92");
    const keptOutsider = await prisma.student.findUniqueOrThrow({ where: { id: outsider.id } });
    assert.equal(keptOutsider.schoolId, other.id);
    assert.equal(keptOutsider.name, "Siswa Sekolah Lain");
    assert.equal(keptOutsider.gender, "PEREMPUAN");
    const placed = await prisma.student.findUniqueOrThrow({ where: { nisn: "7100001801" } });
    assert.equal(placed.classId, next.id);
    assert.equal(await prisma.student.findUnique({ where: { nisn: "7100001802" } }), null);
    assert.equal(await prisma.student.findUnique({ where: { nisn: "7100001888" } }), null);
    assert.equal(await prisma.attendanceRecord.count({ where: { studentId: history.id } }), 0);
    assert.equal(await prisma.reportCardWorkflow.count({ where: { studentId: history.id } }), 0);

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${adminToken}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    assert.equal(again.statusCode, 200);
    const againBody = JSON.parse(again.body) as ImportPreviewDto;
    assert.equal(againBody.createCount, 0);
    assert.equal(againBody.updateCount, 0);
    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/commit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { academicYearId: year.id, rows: againBody.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })) },
    });
    assert.equal(repeat.statusCode, 200);
    assert.equal((JSON.parse(repeat.body) as ImportCommitDto).created, 0);
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 55);
    assert.equal(await prisma.student.count({ where: { nik: "3171010101010001" } }), 1);
  });

  it("mempratinjau berkas sekolah asli tanpa menulis siswa", async () => {
    assert.equal(existsSync(SCHOOL_FILE), true);
    const school = await prisma.school.create({ data: { name: "SMK Berkas Asli", npsn: "90110071" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const admin = await prisma.user.create({ data: { email: "admin@import01.uji.local", name: "Admin Berkas", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    const { readFileSync } = await import("node:fs");
    const file = readFileSync(SCHOOL_FILE);
    const body = multipart("data-siswa-sekolah.xlsx", file, year.id);
    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${await tokenFor(admin.email)}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    if (preview.statusCode !== 200) {
      const message = (JSON.parse(preview.body) as { error?: { message?: string } }).error?.message ?? "pratinjau gagal";
      assert.fail(message);
    }
    const previewBody = JSON.parse(preview.body) as ImportPreviewDto;
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 0);
    const studentSheets = previewBody.sheets?.filter((sheet) => sheet.role === "students") ?? [];
    const skipped = previewBody.sheets?.filter((sheet) => sheet.role === "skipped").map((sheet) => sheet.name) ?? [];
    const historical = previewBody.sheets?.filter((sheet) => sheet.role === "historical").map((sheet) => sheet.name) ?? [];
    assert.ok(studentSheets.length >= 30);
    assert.ok(studentSheets.reduce((sum, sheet) => sum + sheet.rowCount, 0) > 50);
    assert.ok(skipped.some((name) => /rekap/i.test(name)));
    assert.ok(historical.some((name) => /mutasi/i.test(name)));
    const rows = previewBody.rows.filter((row) => row.data.peran !== "sheet");
    const counts = {
      rows: rows.length,
      readyCreate: previewBody.createCount ?? 0,
      readyUpdate: previewBody.updateCount ?? 0,
      needsReview: previewBody.reviewCount ?? 0,
      duplicate: previewBody.duplicateCount ?? 0,
      rejected: previewBody.failedCount ?? 0,
      skipped: previewBody.skippedCount ?? 0,
      emptyNisn: rows.filter((row) => row.errors.some((error) => error.includes("NISN kosong"))).length,
      invalidNisn: rows.filter((row) => row.errors.some((error) => error.includes("NISN tidak valid"))).length,
      duplicateNisn: rows.filter((row) => row.errors.some((error) => error.includes("NISN duplikat"))).length,
      duplicateNik: rows.filter((row) => row.errors.some((error) => error.includes("NIK duplikat"))).length,
      missingClass: rows.filter((row) => row.errors.some((error) => error.includes("Kelas tidak ditemukan"))).length,
      studentSheets: studentSheets.length,
      skippedSheets: skipped.length,
      historicalSheets: historical.length,
      unmatchedClasses: previewBody.classMatches?.filter((item) => item.status === "MISSING").length ?? 0,
      unmapped: previewBody.unmappedColumns ?? [],
    };
    assert.ok(counts.rows > 50);
    assert.equal(counts.readyCreate, 0);
    assert.ok(counts.missingClass > 50);
    assert.equal(counts.unmatchedClasses, studentSheets.length);
    console.log(JSON.stringify({ beforeClasses: counts, reasons: previewBody.reasonCounts }));

    const token = await tokenFor(admin.email);
    const missing = previewBody.classMatches?.filter((item) => item.status === "MISSING" && item.gradeLevel !== null && item.gradeLevel >= 10 && item.gradeLevel <= 13) ?? [];
    for (const item of missing) {
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/schools/${school.id}/classes`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { academicYearId: year.id, concentrationId: null, name: item.sourceName, gradeLevel: item.gradeLevel, capacity: 36, isActive: true },
      });
      assert.equal(created.statusCode, 201);
    }
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 0);
    const mappedBody = multipart("data-siswa-sekolah.xlsx", file, year.id);
    const mapped = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${mappedBody.boundary}` },
      payload: mappedBody.payload,
    });
    assert.equal(mapped.statusCode, 200);
    const mappedJson = JSON.parse(mapped.body) as ImportPreviewDto;
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 0);
    const names = new Set(studentSheets.map((sheet) => sheet.name.replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID")));
    const matches = mappedJson.classMatches?.filter((item) => names.has(item.sourceName.toLocaleLowerCase("id-ID"))) ?? [];
    assert.equal(matches.length, studentSheets.length);
    assert.ok(matches.every((item) => item.status === "MATCHED"));
    const repeatedBody = multipart("data-siswa-sekolah.xlsx", file, year.id);
    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${repeatedBody.boundary}` },
      payload: repeatedBody.payload,
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 0);
    console.log(JSON.stringify({
      afterClasses: {
        readyCreate: mappedJson.createCount ?? 0,
        readyUpdate: mappedJson.updateCount ?? 0,
        needsReview: mappedJson.reviewCount ?? 0,
        duplicate: mappedJson.duplicateCount ?? 0,
        rejected: mappedJson.failedCount ?? 0,
        skipped: mappedJson.skippedCount ?? 0,
        matchedClasses: matches.length,
      },
      reasons: mappedJson.reasonCounts,
    }));
  });

  it("memetakan singkatan kelas dan tidak menggabungkan siswa yang hanya sama namanya", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Impor Alias", npsn: "90110071" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const master = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TJKT 1", gradeLevel: 10 } });
    const admin = await prisma.user.create({ data: { email: "alias@import01.uji.local", name: "Admin Alias", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("X TJKJ 1");
    sheet.addRow(["NO", "NISN", "NAMA SISWA", "L/P"]);
    sheet.addRow([1, "8100001001", "Nama Sama Uji", "L"]);
    sheet.addRow([2, "8100001002", "Nama Sama Uji", "L"]);
    sheet.addRow([3, "", "Siswa Tanpa NISN", "P"]);
    sheet.addRow([4, "8100001003", "AB", "L"]);
    sheet.addRow([5, "8100001001", "Salinan NISN", "L"]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const token = await tokenFor(admin.email);
    const body = multipart("alias.xlsx", file, year.id);
    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${body.boundary}` },
      payload: body.payload,
    });
    assert.equal(preview.statusCode, 200);
    const previewBody = JSON.parse(preview.body) as ImportPreviewDto;
    assert.equal(previewBody.classMatches?.find((item) => item.sourceName === "X TJKJ 1")?.status, "MATCHED");
    assert.equal(previewBody.classMatches?.find((item) => item.sourceName === "X TJKJ 1")?.className, "X TJKT 1");
    assert.equal(await prisma.schoolClass.count({ where: { schoolId: school.id } }), 1);
    const sameName = previewBody.rows.filter((row) => row.data.nama === "Nama Sama Uji");
    assert.equal(sameName.length, 2);
    assert.ok(sameName.every((row) => row.status === "READY_CREATE"));
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Tanpa NISN")?.status, "NEEDS_REVIEW");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "AB")?.status, "REJECTED");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Salinan NISN")?.status, "DUPLICATE");

    const commit = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/commit`,
      headers: { authorization: `Bearer ${token}` },
      payload: { academicYearId: year.id, rows: previewBody.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })) },
    });
    assert.equal(commit.statusCode, 200);
    assert.equal((JSON.parse(commit.body) as ImportCommitDto).created, 2);
    const stored = await prisma.student.findMany({ where: { schoolId: school.id, name: "Nama Sama Uji" }, select: { classId: true, nisn: true } });
    assert.equal(stored.length, 2);
    assert.ok(stored.every((item) => item.classId === master.id));
    const repeatBody = multipart("alias.xlsx", file, year.id);
    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/imports/students/preview`,
      headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${repeatBody.boundary}` },
      payload: repeatBody.payload,
    });
    const repeatJson = JSON.parse(repeat.body) as ImportPreviewDto;
    assert.equal(repeatJson.createCount, 0);
    assert.equal(await prisma.student.count({ where: { schoolId: school.id } }), 2);
  });
});
