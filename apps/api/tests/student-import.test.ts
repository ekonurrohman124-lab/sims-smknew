import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { LightMyRequestResponse } from "fastify";
import type { ApiErrorBody, ImportCommitDto, ImportPreviewDto, LoginResponse } from "@sims/shared";
import {
  assignRole,
  authHeader,
  closeTestContext,
  createSchool,
  createTestContext,
  createUser,
  jsonBody,
  loginRequest,
  migrateTestDatabase,
  resetDatabase,
  type TestContext,
} from "./helpers.ts";

const PASSWORD = "RahasiaUji!2026";

async function tokenFor(context: TestContext, email: string): Promise<string> {
  const response = await loginRequest(context.app, email, PASSWORD);
  assert.equal(response.statusCode, 200, response.body);
  return jsonBody<LoginResponse>(response).accessToken;
}

async function call(
  context: TestContext,
  method: "GET" | "POST",
  url: string,
  token: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return context.app.inject({
    method,
    url,
    headers: authHeader(token),
    payload: payload as string | undefined,
  });
}

function multipart(filename: string, content: Buffer, yearId?: string) {
  const boundary = "----sims-student-import-9f3a7c";
  const chunks: Buffer[] = [];
  if (yearId) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="academicYearId"\r\n\r\n${yearId}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  chunks.push(content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(chunks) };
}

async function upload(
  context: TestContext,
  token: string,
  schoolId: string,
  filename: string,
  content: Buffer,
  yearId?: string,
) {
  const body = multipart(filename, content, yearId);
  return context.app.inject({
    method: "POST",
    url: `/api/v1/schools/${schoolId}/imports/students/preview`,
    headers: { ...authHeader(token), "content-type": `multipart/form-data; boundary=${body.boundary}` },
    payload: body.payload,
  });
}

async function workbookFile(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Siswa");
  sheet.addRow(["NISN", "NIS", "Nama Lengkap", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Kelas"]);
  const add = (values: Array<string | Date>) => {
    const row = sheet.addRow(values);
    row.getCell(1).value = String(values[0]);
    row.getCell(1).numFmt = "@";
    row.getCell(2).value = String(values[1]);
    row.getCell(2).numFmt = "@";
    return row;
  };
  for (let index = 1; index <= 8; index += 1) {
    add([
      `001234560${index}`,
      `0001${index}`,
      `Siswa Import ${String(index).padStart(2, "0")}`,
      index % 2 === 0 ? "P" : "L",
      "Lampung",
      "20/05/2008",
      index === 3 ? "x tkj 1" : "X TKJ 1",
    ]);
  }
  add(["0012345609", "00019", "Siswa Tanpa Kelas", "L", "Lampung", "2008-05-20", ""]);
  const dated = add(["0012345610", "00020", "Siswa Tanggal Excel", "P", "Jakarta", new Date(Date.UTC(2008, 0, 15)), "X TKJ 1"]);
  dated.getCell(6).numFmt = "yyyy-mm-dd";
  add(["0012345601", "00099", "Siswa Duplikat NISN", "L", "", "", "X TKJ 1"]);
  add(["0012345699", "00011", "Siswa Duplikat NIS", "L", "", "", "X TKJ 1"]);
  add(["9999999901", "00088", "Siswa NISN Lama", "L", "", "", "X TKJ 1"]);
  add(["0012345688", "9001", "Siswa NIS Lama", "P", "", "", "X TKJ 1"]);
  add(["0012345681", "00081", "Siswa Kelas Hilang", "L", "", "", "Kelas Khayalan"]);
  add(["0012345682", "00082", "Siswa Kelas Tetangga", "L", "", "", "Kelas Tetangga"]);
  add(["123", "00083", "Siswa NISN Pendek", "L", "", "", "X TKJ 1"]);
  add(["0012345684", "00084", "Siswa Gender Salah", "X", "", "", "X TKJ 1"]);
  add(["0012345685", "00085", "Siswa Tanggal Salah", "L", "", "32/13/2008", "X TKJ 1"]);
  add(["0012345686", "00086", "Ab", "L", "", "", "X TKJ 1"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Impor siswa", { concurrency: 1 }, () => {
  let context: TestContext;

  before(async () => {
    migrateTestDatabase();
    context = await createTestContext();
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  after(async () => {
    await closeTestContext(context);
  });

  it("mengimpor siswa valid dari Excel tanpa mengubah data lama", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Impor Siswa", npsn: "40110021" });
    const other = await createSchool(context.prisma, { name: "SMK Impor Lain", npsn: "40110022" });
    const closed = await createSchool(context.prisma, { name: "SMK Impor Tutup", npsn: "40110023" });
    await context.prisma.school.update({ where: { id: closed.id }, data: { accessStatus: "NONAKTIF", isActive: false } });
    const year = await context.prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const otherYear = await context.prisma.academicYear.create({
      data: { schoolId: other.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const schoolClass = await context.prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10 },
    });
    await context.prisma.schoolClass.create({
      data: { schoolId: other.id, academicYearId: otherYear.id, name: "Kelas Tetangga", gradeLevel: 10 },
    });
    const period = await context.prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "2026/2027 Ganjil", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const subject = await context.prisma.subject.create({ data: { schoolId: school.id, code: "MTK", name: "Matematika" } });
    const teacher = await context.prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Tetap", gender: "LAKI_LAKI" } });
    const assignment = await context.prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: schoolClass.id, academicPeriodId: period.id },
    });
    const existing = await context.prisma.student.create({
      data: { schoolId: school.id, nisn: "9999999901", nis: "9001", name: "Siswa Lama", gender: "PEREMPUAN", classId: schoolClass.id },
    });

    const admin = await createUser(context.prisma, { email: "admin.impor.siswa@uji.local", name: "Admin Impor", password: PASSWORD });
    const owner = await createUser(context.prisma, { email: "owner.impor.siswa@uji.local", name: "Pemilik Impor", password: PASSWORD });
    const guru = await createUser(context.prisma, { email: "guru.impor.siswa@uji.local", name: "Guru Impor", password: PASSWORD });
    const neighbor = await createUser(context.prisma, { email: "admin.lain.impor@uji.local", name: "Admin Lain", password: PASSWORD });
    const closedAdmin = await createUser(context.prisma, { email: "admin.tutup.impor@uji.local", name: "Admin Tutup", password: PASSWORD });
    await assignRole(context.prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await assignRole(context.prisma, { userId: owner.id, roleCode: "SYSTEM_OWNER", schoolId: null });
    await assignRole(context.prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await assignRole(context.prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    await assignRole(context.prisma, { userId: closedAdmin.id, roleCode: "ADMIN_SEKOLAH", schoolId: closed.id });
    const adminToken = await tokenFor(context, admin.email);
    const ownerToken = await tokenFor(context, owner.email);
    const guruToken = await tokenFor(context, guru.email);
    const neighborToken = await tokenFor(context, neighbor.email);
    const closedToken = await tokenFor(context, closedAdmin.email);

    const template = await call(context, "GET", `/api/v1/schools/${school.id}/imports/students/template?format=xlsx&academicYearId=${year.id}`, ownerToken);
    assert.equal(template.statusCode, 200, template.body);
    assert.match(String(template.headers["content-type"]), /spreadsheetml/);
    assert.equal(template.rawPayload.subarray(0, 2).toString(), "PK");
    const templateBook = new ExcelJS.Workbook();
    await templateBook.xlsx.load(template.rawPayload as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
    assert.equal(templateBook.getWorksheet("Siswa")?.getCell("A1").text, "NISN");
    assert.equal(templateBook.getWorksheet("Daftar Kelas")?.getCell("A2").text, "X TKJ 1");

    const guruDenied = await upload(context, guruToken, school.id, "siswa.csv", Buffer.from("nisn,nama,jenis_kelamin\n0011111101,Siswa Guru,L\n"));
    assert.equal(guruDenied.statusCode, 403, guruDenied.body);
    const neighborDenied = await upload(context, neighborToken, school.id, "siswa.csv", Buffer.from("nisn,nama,jenis_kelamin\n0011111101,Siswa Lain,L\n"));
    assert.equal(neighborDenied.statusCode, 403, neighborDenied.body);
    const closedDenied = await upload(context, closedToken, closed.id, "siswa.csv", Buffer.from("nisn,nama,jenis_kelamin\n0011111101,Siswa Tutup,L\n"));
    assert.equal(closedDenied.statusCode, 403, closedDenied.body);
    assert.equal(jsonBody<ApiErrorBody>(closedDenied).error.code, "SCHOOL_INACTIVE");

    const badType = await upload(context, adminToken, school.id, "siswa.xls", Buffer.from("bukan excel"));
    assert.equal(badType.statusCode, 400, badType.body);
    assert.match(badType.body, /XLSX atau CSV/);
    const badHeader = await upload(context, adminToken, school.id, "siswa.csv", Buffer.from("foo,bar\n1,2\n"));
    assert.equal(badHeader.statusCode, 400, badHeader.body);
    assert.match(badHeader.body, /Format berkas tidak sesuai/);
    const wrongYear = await upload(context, adminToken, school.id, "siswa.csv", Buffer.from("nisn,nama,jenis_kelamin\n0011111101,Siswa Tahun,L\n"), otherYear.id);
    assert.equal(wrongYear.statusCode, 400, wrongYear.body);
    assert.match(wrongYear.body, /Tahun pelajaran tidak ditemukan/);
    const tooMany = ["nisn,nama,jenis_kelamin", ...Array.from({ length: 4001 }, () => "0000000000,Nama Panjang,L")].join("\n");
    const limited = await upload(context, adminToken, school.id, "siswa.csv", Buffer.from(tooMany));
    assert.equal(limited.statusCode, 400, limited.body);
    assert.match(limited.body, /4\.000 baris/);

    const beforeStudents = await context.prisma.student.count({ where: { schoolId: school.id } });
    const beforeAudit = await context.prisma.auditLog.count({ where: { action: "STUDENTS_IMPORTED" } });
    const bom = await upload(context, adminToken, school.id, "siswa.csv", Buffer.from("\uFEFFNISN,NIS,Nama Lengkap,Jenis Kelamin\n0011111101,00001,Siswa CSV,L\n"));
    assert.equal(bom.statusCode, 200, bom.body);
    const bomBody = jsonBody<ImportPreviewDto>(bom);
    assert.equal(bomBody.validCount, 1);
    assert.equal(bomBody.rows[0]?.data.nisn, "0011111101");
    assert.equal(await context.prisma.student.count({ where: { schoolId: school.id } }), beforeStudents);
    assert.equal(await context.prisma.auditLog.count({ where: { action: "STUDENTS_IMPORTED" } }), beforeAudit);

    const file = await workbookFile();
    const footprint = {
      users: await context.prisma.user.count(),
      classes: await context.prisma.schoolClass.count(),
      teachings: await context.prisma.teachingAssignment.count(),
      formative: await context.prisma.formativeScore.count(),
      summative: await context.prisma.summativeScore.count(),
      term: await context.prisma.termExamScore.count(),
      finals: await context.prisma.gradeFinalResult.count(),
      daily: await context.prisma.dailyAttendance.count(),
      snapshots: await context.prisma.reportCardSnapshot.count(),
      descriptions: await context.prisma.competencyDescription.count(),
      notes: await context.prisma.homeroomNote.count(),
    };
    const preview = await upload(context, adminToken, school.id, "siswa.xlsx", file, year.id);
    assert.equal(preview.statusCode, 200, preview.body);
    const previewBody = jsonBody<ImportPreviewDto>(preview);
    assert.equal(previewBody.totalCount, 20);
    assert.equal(previewBody.validCount, 10);
    assert.equal(previewBody.duplicateCount, 2);
    assert.equal(previewBody.failedCount, 1);
    assert.equal(previewBody.reviewCount, 7);
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Hilang")?.status, "NEEDS_REVIEW");
    assert.match(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Hilang")?.errors.join(" ") ?? "", /tidak ditemukan/);
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Kelas Tetangga")?.status, "NEEDS_REVIEW");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa Duplikat NISN")?.status, "DUPLICATE");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa NISN Lama")?.status, "NEEDS_REVIEW");
    assert.equal(previewBody.rows.find((row) => row.data.nama === "Siswa NIS Lama")?.status, "NEEDS_REVIEW");
    assert.equal(await context.prisma.student.count({ where: { schoolId: school.id } }), 1);

    const commit = await call(context, "POST", `/api/v1/schools/${school.id}/imports/students/commit`, adminToken, {
      academicYearId: year.id,
      rows: previewBody.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })),
    });
    assert.equal(commit.statusCode, 200, commit.body);
    const commitBody = jsonBody<ImportCommitDto>(commit);
    assert.equal(commitBody.created, 10);
    assert.equal(commitBody.updated ?? 0, 0);
    assert.equal(commitBody.duplicateCount, 2);
    assert.equal(commitBody.failedCount, 1);
    assert.equal(await context.prisma.student.count({ where: { schoolId: school.id } }), 11);

    const leading = await context.prisma.student.findUniqueOrThrow({ where: { nisn: "0012345601" } });
    assert.equal(leading.schoolId, school.id);
    assert.equal(leading.nis, "00011");
    assert.equal(leading.classId, schoolClass.id);
    assert.equal(leading.gender, "LAKI_LAKI");
    assert.equal(leading.birthPlace, "Lampung");
    assert.equal(leading.birthDate?.toISOString().slice(0, 10), "2008-05-20");
    const folded = await context.prisma.student.findUniqueOrThrow({ where: { nisn: "0012345603" } });
    assert.equal(folded.classId, schoolClass.id);
    const unplaced = await context.prisma.student.findUniqueOrThrow({ where: { nisn: "0012345609" } });
    assert.equal(unplaced.classId, null);
    const datedStudent = await context.prisma.student.findUniqueOrThrow({ where: { nisn: "0012345610" } });
    assert.equal(datedStudent.birthDate?.toISOString().slice(0, 10), "2008-01-15");
    assert.equal(datedStudent.gender, "PEREMPUAN");
    assert.equal(datedStudent.classId, schoolClass.id);
    const unchanged = await context.prisma.student.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(unchanged.name, "Siswa Lama");
    assert.equal(unchanged.nisn, existing.nisn);
    assert.equal(unchanged.nis, existing.nis);
    assert.equal(unchanged.classId, existing.classId);
    assert.equal(unchanged.updatedAt.getTime(), existing.updatedAt.getTime());
    const keptAssignment = await context.prisma.teachingAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.equal(keptAssignment.updatedAt.getTime(), assignment.updatedAt.getTime());

    const again = await upload(context, adminToken, school.id, "siswa.xlsx", file, year.id);
    const againBody = jsonBody<ImportPreviewDto>(again);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(againBody.validCount, 0);
    const repeat = await call(context, "POST", `/api/v1/schools/${school.id}/imports/students/commit`, adminToken, {
      academicYearId: year.id,
      rows: againBody.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })),
    });
    assert.equal(jsonBody<ImportCommitDto>(repeat).created, 0);
    assert.equal(await context.prisma.student.count({ where: { schoolId: school.id } }), 11);

    const ownerCommit = await call(context, "POST", `/api/v1/schools/${school.id}/imports/students/commit`, ownerToken, {
      rows: [{ nisn: "0012345700", nama: "Siswa Pemilik", jenis_kelamin: "L" }],
    });
    assert.equal(ownerCommit.statusCode, 200, ownerCommit.body);
    assert.equal(jsonBody<ImportCommitDto>(ownerCommit).created, 1);
    const ownerStudent = await context.prisma.student.findUniqueOrThrow({ where: { nisn: "0012345700" } });
    assert.equal(ownerStudent.schoolId, school.id);
    assert.equal(ownerStudent.classId, null);

    const audits = await context.prisma.auditLog.findMany({
      where: { schoolId: school.id, action: "STUDENTS_IMPORTED" },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(audits.length, 3);
    assert.equal(audits[0]?.actorId, admin.id);
    assert.equal((audits[0]?.metadata as { created?: number } | null)?.created, 10);
    assert.equal(audits[2]?.actorId, owner.id);
    assert.ok(audits[0]?.createdAt);
    assert.equal(await context.prisma.student.count({ where: { schoolId: other.id } }), 0);
    assert.equal(await context.prisma.student.count({ where: { schoolId: closed.id } }), 0);
    assert.deepEqual(
      {
        users: await context.prisma.user.count(),
        classes: await context.prisma.schoolClass.count(),
        teachings: await context.prisma.teachingAssignment.count(),
        formative: await context.prisma.formativeScore.count(),
        summative: await context.prisma.summativeScore.count(),
        term: await context.prisma.termExamScore.count(),
        finals: await context.prisma.gradeFinalResult.count(),
        daily: await context.prisma.dailyAttendance.count(),
        snapshots: await context.prisma.reportCardSnapshot.count(),
        descriptions: await context.prisma.competencyDescription.count(),
        notes: await context.prisma.homeroomNote.count(),
      },
      footprint,
    );
  });
});
