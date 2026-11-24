import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const OWNED_NPSN = ["90110201", "90110202", "90110203"];
const PASSWORD = "RahasiaUji!2026";
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OFFICIAL_DIR = "C:/Users/User/Downloads/Kaldik Prov. Lampung 2026_2027 (Websiteedukasi.com)/Kaldik Prov. Lampung 2026_2027 (Websiteedukasi.com)";

dotenv.config({ path: resolve(apiRoot, ".env") });
const storageDir = mkdtempSync(join(tmpdir(), "sims-kaldik01-"));
process.env.EDUCATION_CALENDAR_DIR = storageDir;

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
process.env.DATABASE_URL = isolatedUrl;
process.env.NODE_ENV = "development";

let prisma: PrismaClient;
let app: FastifyInstance;
let grantAssignment: typeof import("../src/modules/access/assignments.ts").grantAssignment;
let hashPassword: typeof import("../src/lib/password.ts").hashPassword;

function docx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const name = Buffer.from("word/document.xml");
  const data = Buffer.from(xml);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, data]);
}

function pdf(lines: string[]): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((line) => `(${line}) Tj T*`).join(" ")} ET`;
  return Buffer.from(`%PDF-1.4\n4 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj\n`);
}

function multipart(filename: string, mime: string, content: Buffer, yearId: string) {
  const boundary = `----kaldik${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="academicYearId"\r\n\r\n${yearId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

async function assertDatabase(client: PrismaClient, expected: string): Promise<void> {
  const rows = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (rows[0]?.name !== expected || BANNED_DATABASES.has(rows[0]?.name ?? "")) throw new Error("Pengujian berhenti karena database bukan target yang diminta.");
}

async function wipeOwnedRows(): Promise<void> {
  await assertDatabase(prisma, TARGET_DATABASE);
  const schools = await prisma.school.findMany({ where: { npsn: { in: OWNED_NPSN } }, select: { id: true } });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.teachingAssignment.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.subject.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@kaldik01.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 200);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

describe("kalender pendidikan", { concurrency: 1 }, () => {
  before(async () => {
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
    const application = await import("../src/app.ts");
    grantAssignment = access.grantAssignment;
    hashPassword = passwords.hashPassword;
    await access.ensureRoles(prisma);
    app = await application.buildApp({ prisma });
    await app.ready();
    await wipeOwnedRows();
  });

  after(async () => {
    await wipeOwnedRows();
    await app.close();
    await prisma.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("mengekstrak, menolak berkas buruk, dan menerapkan semester tanpa duplikasi", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Kalender Uji", npsn: "90110201" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Kalender Lain", npsn: "90110202" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-14T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: false },
    });
    const student = await prisma.student.create({ data: { schoolId: school.id, nisn: "9011020101", name: "Siswa Kalender Uji", gender: "PEREMPUAN" } });
    const passwordHash = await hashPassword(PASSWORD);
    const admin = await prisma.user.create({ data: { email: "admin@kaldik01.uji.local", name: "Admin Kalender", passwordHash } });
    const wakakur = await prisma.user.create({ data: { email: "wakakur@kaldik01.uji.local", name: "Wakakur Kalender", passwordHash } });
    const guru = await prisma.user.create({ data: { email: "guru@kaldik01.uji.local", name: "Guru Kalender", passwordHash } });
    const neighbor = await prisma.user.create({ data: { email: "tetangga@kaldik01.uji.local", name: "Admin Tetangga", passwordHash } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: wakakur.id, roleCode: "WAKAKUR", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    const adminHeaders = { authorization: `Bearer ${await tokenFor(admin.email)}` };
    const wakakurHeaders = { authorization: `Bearer ${await tokenFor(wakakur.email)}` };
    const guruHeaders = { authorization: `Bearer ${await tokenFor(guru.email)}` };
    const neighborHeaders = { authorization: `Bearer ${await tokenFor(neighbor.email)}` };

    const source = docx([
      "Keputusan Nomor 400.3.8/1323/V.01/DP.2/2026",
      "Tahun Pelajaran 2026/2027",
      "NPSN 90110201",
      "Semester Ganjil mulai pembelajaran 13 Juli 2026 sampai 18 Desember 2026",
      "Hari libur 21 Desember 2026 sampai 2 Januari 2027",
      "Asesmen sumatif 7 Desember 2026",
      "Pembagian rapor Jumat 18 Desember 2026",
      "Kegiatan MPLS 13 Juli",
    ]);
    const upload = multipart("kaldik.docx", DOCX_MIME, source, year.id);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${upload.boundary}` },
      payload: upload.body,
    });
    assert.equal(created.statusCode, 201);
    const preview = JSON.parse(created.body) as { duplicate: boolean; document: { id: string; items: Array<{ id: string; title: string; verification: string; eventDate: string | null; category: string }> }; integration: Array<{ semesterKind: string; action: string }> };
    assert.equal(preview.duplicate, false);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 0);
    assert.equal((await prisma.academicYear.findUniqueOrThrow({ where: { id: year.id } })).isActive, false);
    assert.ok(preview.document.items.some((item) => item.category === "SEMESTER" && item.verification === "TERVERIFIKASI" && item.eventDate === "2026-07-13"));
    assert.ok(preview.document.items.some((item) => item.verification === "PERLU_VERIFIKASI" && item.eventDate === null));
    assert.equal(preview.integration.find((item) => item.semesterKind === "GENAP")?.action, "PERLU_KEPUTUSAN");

    const blocked = await app.inject({ method: "POST", url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/publish`, headers: adminHeaders });
    assert.equal(blocked.statusCode, 409);
    const ambiguous = preview.document.items.find((item) => item.verification === "PERLU_VERIFIKASI");
    assert.ok(ambiguous);
    const corrected = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/items/${ambiguous.id}`,
      headers: adminHeaders,
      payload: { title: ambiguous.title, category: "KEGIATAN", semesterKind: null, eventDate: "2026-07-13", endDate: null, verification: "TERVERIFIKASI" },
    });
    assert.equal(corrected.statusCode, 200);
    const published = await app.inject({ method: "POST", url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/publish`, headers: adminHeaders });
    assert.equal(published.statusCode, 200);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 0);

    const both = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/apply`,
      headers: adminHeaders,
      payload: { confirm: true, creates: ["GANJIL", "GENAP"] },
    });
    assert.equal(both.statusCode, 409);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 0);
    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/apply`,
      headers: adminHeaders,
      payload: { confirm: true, creates: ["GANJIL"] },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id, semesterKind: "GANJIL", isActive: false } }), 1);
    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/apply`,
      headers: adminHeaders,
      payload: { confirm: true, creates: ["GANJIL"] },
    });
    assert.equal(repeated.statusCode, 409);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 1);

    const again = multipart("kaldik.docx", DOCX_MIME, source, year.id);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${again.boundary}` },
      payload: again.body,
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal((JSON.parse(duplicate.body) as { duplicate: boolean }).duplicate, true);

    const sheet = pdf(["Keputusan Nomor 9/SK/2026 Tahun Pelajaran 2026/2027 NPSN 90110201", "Asesmen 8 Desember 2026"]);
    const pdfUpload = multipart("kaldik.pdf", "application/pdf", sheet, year.id);
    const pdfResult = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${pdfUpload.boundary}` },
      payload: pdfUpload.body,
    });
    assert.equal(pdfResult.statusCode, 201);
    const draftId = (JSON.parse(pdfResult.body) as { document: { id: string } }).document.id;

    const invalid = multipart("catatan.txt", "text/plain", Buffer.from("bukan kalender"), year.id);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${invalid.boundary}` },
      payload: invalid.body,
    });
    assert.equal(rejected.statusCode, 400);
    const wrongSchool = docx(["NPSN 90110202", "Tahun Pelajaran 2026/2027", "Hari libur 21 Desember 2026"]);
    const wrong = multipart("salah.docx", DOCX_MIME, wrongSchool, year.id);
    const mismatched = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${wrong.boundary}` },
      payload: wrong.body,
    });
    assert.equal(mismatched.statusCode, 422);

    const weekday = docx(["NPSN 90110201", "Tahun Pelajaran 2026/2027", "Hari libur Senin 14 Juli 2026"]);
    const weekdayBody = multipart("hari.docx", DOCX_MIME, weekday, year.id);
    const weekdayResult = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...adminHeaders, "content-type": `multipart/form-data; boundary=${weekdayBody.boundary}` },
      payload: weekdayBody.body,
    });
    assert.equal(weekdayResult.statusCode, 201);
    const weekdayDocument = JSON.parse(weekdayResult.body) as { document: { id: string; items: Array<{ eventDate: string | null; verification: string }> } };
    assert.equal(weekdayDocument.document.items[0]?.eventDate, "2026-07-14");
    assert.equal(weekdayDocument.document.items[0]?.verification, "PERLU_VERIFIKASI");
    const weekdayPublish = await app.inject({ method: "POST", url: `/api/v1/schools/${school.id}/education-calendar/${weekdayDocument.document.id}/publish`, headers: adminHeaders });
    assert.equal(weekdayPublish.statusCode, 409);

    const wakakurUpload = multipart("wakakur.docx", DOCX_MIME, source, year.id);
    const wakakurDenied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...wakakurHeaders, "content-type": `multipart/form-data; boundary=${wakakurUpload.boundary}` },
      payload: wakakurUpload.body,
    });
    assert.equal(wakakurDenied.statusCode, 403);
    const noted = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/notes`,
      headers: wakakurHeaders,
      payload: { body: "Tanggal asesmen perlu dicek kembali." },
    });
    assert.equal(noted.statusCode, 201);
    const wakakurApply = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar/${preview.document.id}/apply`,
      headers: wakakurHeaders,
      payload: { confirm: true, creates: ["GANJIL"] },
    });
    assert.equal(wakakurApply.statusCode, 403);

    const guruList = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/education-calendar`, headers: guruHeaders });
    assert.equal(guruList.statusCode, 200);
    const guruDocuments = (JSON.parse(guruList.body) as { documents: Array<{ id: string; status: string }> }).documents;
    assert.equal(guruDocuments.every((document) => document.status === "PUBLISHED"), true);
    assert.equal(guruDocuments.some((document) => document.id === draftId), false);
    const hidden = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/education-calendar/${draftId}`, headers: guruHeaders });
    assert.equal(hidden.statusCode, 404);
    const foreign = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/education-calendar`, headers: neighborHeaders });
    assert.equal(foreign.statusCode, 403);

    const period = await prisma.academicPeriod.findFirstOrThrow({ where: { schoolId: school.id, semesterKind: "GANJIL" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "KLD", name: "Kalender Uji", category: "UMUM" } });
    const room = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X Uji", gradeLevel: 10, capacity: 36 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Mapel Uji", gender: "LAKI_LAKI" } });
    const assignment = await prisma.teachingAssignment.create({ data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: room.id, academicPeriodId: period.id } });
    const locked = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/semesters/${period.id}`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: period.name, semesterKind: "GANJIL", startDate: "2026-07-20", endDate: "2026-12-18", isActive: false },
    });
    assert.equal(locked.statusCode, 409);
    assert.equal((await prisma.academicPeriod.findUniqueOrThrow({ where: { id: period.id } })).startDate.toISOString().slice(0, 10), "2026-07-13");
    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/semesters/${period.id}`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: period.name, semesterKind: "GANJIL", startDate: "2026-07-13", endDate: "2026-12-18", isActive: false, confirmUsedChange: true },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(await prisma.teachingAssignment.count({ where: { id: assignment.id } }), 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).classId, null);
    assert.equal(await prisma.gradeFinalResult.count({ where: { schoolId: school.id } }), 0);
    const storedYear = await prisma.academicYear.findUniqueOrThrow({ where: { id: year.id } });
    assert.equal(storedYear.startDate.toISOString().slice(0, 10), "2026-07-14");
    assert.equal(storedYear.isActive, false);
  });

  it("membaca dokumen kaldik lampung asli tanpa mengubah data akademik", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Kalender Resmi", npsn: "90110203" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-14T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: false },
    });
    const student = await prisma.student.create({ data: { schoolId: school.id, nisn: "9011020301", name: "Siswa Kalender Resmi", gender: "LAKI_LAKI" } });
    const admin = await prisma.user.create({ data: { email: "resmi@kaldik01.uji.local", name: "Admin Resmi", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    const headers = { authorization: `Bearer ${await tokenFor(admin.email)}` };
    const docxFile = readFileSync(join(OFFICIAL_DIR, "KALDIK LAMPUNG T.A 2026-2027.docx"));
    const xlsxFile = readFileSync(join(OFFICIAL_DIR, "KALDIK LAMPUNG T.A 2026-2027.xlsx"));
    const uploadDocx = multipart("KALDIK LAMPUNG T.A 2026-2027.docx", DOCX_MIME, docxFile, year.id);
    const docxResponse = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${uploadDocx.boundary}` },
      payload: uploadDocx.body,
    });
    assert.equal(docxResponse.statusCode, 201);
    const docxBody = JSON.parse(docxResponse.body) as { document: { decisionNumber: string | null; items: Array<{ title: string; eventDate: string | null; endDate: string | null; source: string; verification: string }> } };
    assert.match(docxBody.document.decisionNumber ?? "", /400\.3\.8\/1323/);
    const firstDay = docxBody.document.items.find((item) => item.title.includes("Hari Pertama Masuk Sekolah"));
    const mpls = docxBody.document.items.find((item) => item.title.includes("MPLS"));
    const report = docxBody.document.items.find((item) => item.title.includes("Pembagian Rapor Semester Genap"));
    assert.equal(firstDay?.eventDate, "2026-07-13");
    assert.equal(mpls?.eventDate, "2026-07-13");
    assert.equal(mpls?.endDate, "2026-07-17");
    assert.equal(report?.eventDate, "2027-06-11");
    const nyepi = docxBody.document.items.find((item) => item.title.includes("Hari Raya Nyepi"));
    const fitriDoc = docxBody.document.items.find((item) => item.title.includes("Perkiraan Libur Idul Fitri"));
    const idul = docxBody.document.items.find((item) => item.title.includes("Hari Raya Idul Fitri"));
    const yearEnd = docxBody.document.items.find((item) => item.title.includes("Libur Akhir Tahun Ajaran"));
    assert.equal(nyepi?.eventDate, "2027-03-08");
    assert.equal(nyepi?.endDate, null);
    assert.equal(fitriDoc?.eventDate, "2027-03-09");
    assert.equal(fitriDoc?.endDate, "2027-03-19");
    assert.equal(fitriDoc?.verification, "PERLU_VERIFIKASI");
    assert.equal(idul?.eventDate, "2027-03-10");
    assert.equal(idul?.endDate, "2027-03-11");
    assert.equal(yearEnd?.eventDate, "2027-06-14");
    assert.equal(yearEnd?.endDate, "2027-07-09");
    assert.equal(yearEnd?.verification, "PERLU_VERIFIKASI");
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 0);

    const uploadXlsx = multipart("KALDIK LAMPUNG T.A 2026-2027.xlsx", XLSX_MIME, xlsxFile, year.id);
    const xlsxResponse = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${uploadXlsx.boundary}` },
      payload: uploadXlsx.body,
    });
    assert.equal(xlsxResponse.statusCode, 201);
    const xlsxBody = JSON.parse(xlsxResponse.body) as { document: { items: Array<{ title: string; eventDate: string | null; endDate: string | null; source: string; verification: string }> } };
    const sheetDay = xlsxBody.document.items.find((item) => item.title.includes("Hari Pertama Masuk Sekolah"));
    const fitri = xlsxBody.document.items.find((item) => item.title.includes("9 s.d. 19 Maret"));
    const oddReport = xlsxBody.document.items.find((item) => item.title.includes("Pembagian Rapor Semester Gasa"));
    assert.equal(sheetDay?.eventDate, "2026-07-13");
    assert.match(sheetDay?.source ?? "", /Kalender Pendidikan Lampung!/);
    assert.equal(fitri?.eventDate, "2027-03-09");
    assert.equal(fitri?.endDate, "2027-03-19");
    assert.equal(fitri?.verification, "PERLU_VERIFIKASI");
    const crossMonth = xlsxBody.document.items.find((item) => item.title.includes("21 Desember - 1 Januari"));
    assert.equal(crossMonth?.eventDate, "2026-12-21");
    assert.equal(crossMonth?.endDate, "2027-01-01");
    assert.equal(crossMonth?.verification, "PERLU_VERIFIKASI");
    const estimate = xlsxBody.document.items.find((item) => item.title.includes("Pada rentang bulan April hingga Mei"));
    assert.equal(estimate?.eventDate, null);
    assert.equal(estimate?.verification, "PERLU_VERIFIKASI");
    assert.equal(oddReport?.eventDate, "2026-12-18");
    assert.equal(xlsxBody.document.items.some((item) => item.verification === "PERLU_VERIFIKASI"), true);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id } }), 0);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).name, "Siswa Kalender Resmi");

    const repeated = multipart("KALDIK LAMPUNG T.A 2026-2027.xlsx", XLSX_MIME, xlsxFile, year.id);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${repeated.boundary}` },
      payload: repeated.body,
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal((JSON.parse(duplicate.body) as { duplicate: boolean }).duplicate, true);
    const broken = multipart("rusak.docx", DOCX_MIME, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(48)]), year.id);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/education-calendar`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${broken.boundary}` },
      payload: broken.body,
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal((await prisma.academicYear.findUniqueOrThrow({ where: { id: year.id } })).isActive, false);
  });
});
