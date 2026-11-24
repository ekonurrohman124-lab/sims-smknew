import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const PASSWORD = "RahasiaUji!2026";
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
    where: { npsn: { in: ["90110001", "90110002"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.gradeFinalResult.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.reportCardWorkflow.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.homeroomAssignment.deleteMany({ where: { schoolId: { in: ids } } });
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
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix01.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

describe("transisi kenaikan kelas", { concurrency: 1 }, () => {
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
  });

  beforeEach(async () => {
    await wipeOwnedRows();
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("memindahkan seluruh siswa tanpa menghapus identitas, nilai, atau rapor", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Transisi", npsn: "90110001" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Lain", npsn: "90110002" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: "2026/2027",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
        isActive: true,
      },
    });
    const period = await prisma.academicPeriod.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: "Ganjil",
        semesterKind: "GANJIL",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
        isActive: true,
      },
    });
    const otherYear = await prisma.academicYear.create({
      data: {
        schoolId: other.id,
        name: "2026/2027",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
      },
    });
    const source = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "XI TKJ 1", gradeLevel: 11 },
    });
    const target = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "XII TKJ 1", gradeLevel: 12 },
    });
    const foreignClass = await prisma.schoolClass.create({
      data: { schoolId: other.id, academicYearId: otherYear.id, name: "XII Asing", gradeLevel: 12 },
    });
    const teacher = await prisma.teacher.create({
      data: { schoolId: school.id, name: "Guru Uji", gender: "LAKI_LAKI" },
    });
    const subject = await prisma.subject.create({
      data: { schoolId: school.id, code: "KJD", name: "Konsentrasi Keahlian", category: "KEJURUAN" },
    });
    const teaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: source.id, academicPeriodId: period.id },
    });
    const homeroom = await prisma.homeroomAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, classId: source.id, academicPeriodId: period.id },
    });
    const identity = await prisma.student.create({
      data: {
        schoolId: school.id,
        classId: source.id,
        nisn: "4011000001",
        nis: "NIS-TETAP",
        name: "Siswa Identitas",
        gender: "PEREMPUAN",
        birthPlace: "Lampung",
        birthDate: new Date("2008-04-12T00:00:00.000Z"),
        email: "siswa.identitas@fix01.uji.local",
        phone: "081234567890",
      },
    });
    await prisma.student.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        schoolId: school.id,
        classId: source.id,
        nisn: `401100${String(index + 2).padStart(4, "0")}`,
        name: `Siswa ${index + 2}`,
        gender: "LAKI_LAKI" as const,
      })),
    });
    const outsider = await prisma.student.create({
      data: { schoolId: other.id, nisn: "4011000099", name: "Siswa Sekolah Lain", gender: "LAKI_LAKI" },
    });
    const grade = await prisma.gradeFinalResult.create({
      data: {
        schoolId: school.id,
        teachingAssignmentId: teaching.id,
        studentId: identity.id,
        score: "88.5000",
        formula: "rata-rata",
        detail: { source: "uji" },
        savedById: teacher.id,
      },
    });
    const report = await prisma.reportCardWorkflow.create({
      data: {
        schoolId: school.id,
        studentId: identity.id,
        classId: source.id,
        homeroomAssignmentId: homeroom.id,
        academicYearId: year.id,
        academicPeriodId: period.id,
      },
    });
    const wakakur = await prisma.user.create({
      data: { email: "wakakur@fix01.uji.local", name: "Wakakur Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    const guru = await prisma.user.create({
      data: { email: "guru@fix01.uji.local", name: "Guru Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    const outsiderUser = await prisma.user.create({
      data: { email: "wakakur.lain@fix01.uji.local", name: "Wakakur Lain", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: wakakur.id, roleCode: "WAKAKUR", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: outsiderUser.id, roleCode: "WAKAKUR", schoolId: other.id });
    const token = await tokenFor(wakakur.email);
    const students = await prisma.student.findMany({ where: { schoolId: school.id, classId: source.id }, select: { id: true } });
    assert.equal(students.length, 51);

    const moved = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "PROMOTE", sourceClassId: source.id, targetClassId: target.id, studentIds: [...students.map((item) => item.id), outsider.id, identity.id] },
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const body = JSON.parse(moved.body) as { succeeded: Array<{ studentId: string }>; failed: Array<{ studentId: string; reason: string }> };
    assert.equal(body.succeeded.length, 51);
    assert.equal(body.failed.length, 1);
    assert.equal(body.failed[0]?.studentId, outsider.id);

    const kept = await prisma.student.findUniqueOrThrow({ where: { id: identity.id } });
    assert.equal(kept.schoolId, school.id);
    assert.equal(kept.classId, target.id);
    assert.equal(kept.nisn, "4011000001");
    assert.equal(kept.nis, "NIS-TETAP");
    assert.equal(kept.name, "Siswa Identitas");
    assert.equal(kept.gender, "PEREMPUAN");
    assert.equal(kept.birthPlace, "Lampung");
    assert.equal(kept.birthDate?.toISOString().slice(0, 10), "2008-04-12");
    assert.equal(kept.email, "siswa.identitas@fix01.uji.local");
    assert.equal(kept.phone, "081234567890");
    assert.equal(kept.isActive, true);
    const keptGrade = await prisma.gradeFinalResult.findUniqueOrThrow({ where: { id: grade.id } });
    assert.equal(keptGrade.studentId, identity.id);
    assert.equal(keptGrade.teachingAssignmentId, teaching.id);
    assert.equal(Number(keptGrade.score), 88.5);
    const keptReport = await prisma.reportCardWorkflow.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(keptReport.studentId, identity.id);
    assert.equal(keptReport.classId, source.id);
    assert.equal(keptReport.schoolId, school.id);
    const sourcePage = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/students?classId=${source.id}&page=1&pageSize=50`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(JSON.parse(sourcePage.body).total, 0);
    const firstPage = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/students?classId=${target.id}&page=1&pageSize=50`,
      headers: { authorization: `Bearer ${token}` },
    });
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/students?classId=${target.id}&page=2&pageSize=50`,
      headers: { authorization: `Bearer ${token}` },
    });
    const first = JSON.parse(firstPage.body) as { total: number; items: unknown[] };
    const second = JSON.parse(secondPage.body) as { items: unknown[] };
    assert.equal(first.total, 51);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 1);
    const otherStudent = await prisma.student.findUniqueOrThrow({ where: { id: outsider.id } });
    assert.equal(otherStudent.schoolId, other.id);
    assert.equal(otherStudent.classId, null);

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "PROMOTE", sourceClassId: source.id, targetClassId: target.id, studentIds: [identity.id] },
    });
    const againBody = JSON.parse(again.body) as { succeeded: unknown[]; failed: Array<{ reason: string }> };
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(againBody.succeeded.length, 0);
    assert.equal(againBody.failed.length, 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: identity.id } })).classId, target.id);

    const guruToken = await tokenFor(guru.email);
    const deniedGuru = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${guruToken}` },
      payload: { mode: "PROMOTE", sourceClassId: target.id, targetClassId: source.id, studentIds: [identity.id] },
    });
    assert.equal(deniedGuru.statusCode, 403, deniedGuru.body);
    const otherToken = await tokenFor(outsiderUser.email);
    const deniedSchool = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { mode: "PROMOTE", sourceClassId: target.id, targetClassId: source.id, studentIds: [identity.id] },
    });
    assert.equal(deniedSchool.statusCode, 403, deniedSchool.body);
    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "PROMOTE", sourceClassId: target.id, targetClassId: foreignClass.id, studentIds: [identity.id] },
    });
    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: identity.id } })).classId, target.id);
  });

  it("menyimpan tahun lulus tanpa menghapus siswa atau histori rapor", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Lulus", npsn: "90110001" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: "2026/2027",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
        isActive: true,
      },
    });
    const period = await prisma.academicPeriod.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: "Genap",
        semesterKind: "GENAP",
        startDate: new Date("2027-01-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
        isActive: true,
      },
    });
    const source = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "XII TKJ 1", gradeLevel: 12 },
    });
    const teacher = await prisma.teacher.create({
      data: { schoolId: school.id, name: "Wali Uji", gender: "LAKI_LAKI" },
    });
    const subject = await prisma.subject.create({
      data: { schoolId: school.id, code: "MTK", name: "Matematika", category: "UMUM" },
    });
    const teaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: source.id, academicPeriodId: period.id },
    });
    const homeroom = await prisma.homeroomAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, classId: source.id, academicPeriodId: period.id },
    });
    const student = await prisma.student.create({
      data: {
        schoolId: school.id,
        classId: source.id,
        nisn: "4011000001",
        name: "Calon Alumni",
        gender: "LAKI_LAKI",
        birthPlace: "Metro",
        birthDate: new Date("2007-01-20T00:00:00.000Z"),
        email: "alumni@fix01.uji.local",
        phone: "081200000000",
      },
    });
    const grade = await prisma.gradeFinalResult.create({
      data: {
        schoolId: school.id,
        teachingAssignmentId: teaching.id,
        studentId: student.id,
        score: "90.0000",
        formula: "akhir",
        detail: { source: "uji" },
        savedById: teacher.id,
      },
    });
    const report = await prisma.reportCardWorkflow.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        classId: source.id,
        homeroomAssignmentId: homeroom.id,
        academicYearId: year.id,
        academicPeriodId: period.id,
        status: "DISAHKAN",
      },
    });
    const wakakur = await prisma.user.create({
      data: { email: "wakakur.lulus@fix01.uji.local", name: "Wakakur Lulus", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: wakakur.id, roleCode: "WAKAKUR", schoolId: school.id });
    const token = await tokenFor(wakakur.email);

    const graduated = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "GRADUATE", sourceClassId: source.id, graduationYear: 2026, studentIds: [student.id] },
    });
    assert.equal(graduated.statusCode, 200, graduated.body);
    const kept = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(kept.schoolId, school.id);
    assert.equal(kept.classId, null);
    assert.equal(kept.isActive, false);
    assert.equal(kept.email, "alumni@fix01.uji.local");
    assert.equal(kept.phone, "081200000000");
    assert.equal(kept.birthPlace, "Metro");
    assert.equal(kept.birthDate?.toISOString().slice(0, 10), "2007-01-20");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: student.id, action: "STUDENT_GRADUATED" } });
    assert.equal((log.metadata as { graduationYear?: number }).graduationYear, 2026);
    assert.equal((await prisma.gradeFinalResult.findUniqueOrThrow({ where: { id: grade.id } })).studentId, student.id);
    const keptReport = await prisma.reportCardWorkflow.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(keptReport.status, "DISAHKAN");
    assert.equal(keptReport.classId, source.id);

    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: "GRADUATE", sourceClassId: source.id, graduationYear: 2026, studentIds: [student.id] },
    });
    const repeatBody = JSON.parse(repeat.body) as { succeeded: unknown[]; failed: unknown[] };
    assert.equal(repeatBody.succeeded.length, 0);
    assert.equal(repeatBody.failed.length, 1);
    assert.equal(await prisma.student.count({ where: { id: student.id } }), 1);
  });
});
