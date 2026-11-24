import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { parseMatrixSheet } from "../../web/src/lib/gradeImport.ts";

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
if (databaseName(isolatedUrl) !== TARGET_DATABASE) throw new Error("URL database uji tidak sah.");
process.env.DATABASE_URL = isolatedUrl;
process.env.NODE_ENV = "development";

describe("parser impor nilai", () => {
  it("mempertahankan nilai 0 dan menolak nilai di luar rentang", () => {
    const matrix = [
      ["Nama Siswa", "TP 1 Tujuan satu", "TP 1 Tujuan satu"],
      ["", "UH", "T1"],
      ["", "", ""],
      ["", "", ""],
      ["Budi Santoso", "0", ""],
      ["Ani Wijaya", "", "80"],
      ["Cici Lestari", "101", ""],
      ["Orang Asing", "70", ""],
    ];
    const parsed = parseMatrixSheet("Nilai", matrix, [
      { id: "budi", name: "Budi Santoso", nis: "01" },
      { id: "ani", name: "Ani Wijaya", nis: "02" },
      { id: "cici", name: "Cici Lestari", nis: "03" },
    ], false);
    const uh = parsed.columns.find((column) => column.field === "uh");
    const task = parsed.columns.find((column) => column.field === "t1");
    assert.equal(uh?.values.budi, "0");
    assert.equal(uh?.values.ani, undefined);
    assert.equal(uh?.values.cici, undefined);
    assert.equal(task?.values.ani, "80");
    assert.equal(parsed.stats.rejectedInvalid, 1);
    assert.ok(parsed.stats.skippedEmpty > 0);
    assert.deepEqual(parsed.stats.unmatchedNames, ["Orang Asing"]);
  });
});

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
  if (name !== expected || BANNED_DATABASES.has(name ?? "")) throw new Error("Pengujian berhenti karena database bukan target yang diminta.");
}

async function ensureDatabase(): Promise<void> {
  const adminUrl = new URL(isolatedUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await assertDatabase(admin, "postgres");
    const found = await admin.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname = ${TARGET_DATABASE}`;
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${TARGET_DATABASE}"`);
  } finally {
    await admin.$disconnect();
  }
}

async function wipeOwnedRows(): Promise<void> {
  await assertDatabase(prisma, TARGET_DATABASE);
  const schools = await prisma.school.findMany({ where: { npsn: { in: ["90110031", "90110032"] } }, select: { id: true } });
  const ids = schools.map((school) => school.id);
  if (ids.length === 0) {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@fix03.uji.local" } } });
    return;
  }
  await prisma.reportCardWorkflow.updateMany({ where: { schoolId: { in: ids } }, data: { activeSnapshotId: null } });
  await prisma.reportCardEvent.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.reportCardSnapshot.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.reportCardWorkflow.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.reportReview.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.studentReportActivity.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.homeroomNoteCorrection.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.homeroomNote.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.competencyDescriptionEntry.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.competencyDescription.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.dailyAttendanceRecord.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.dailyAttendance.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.attendanceCalendarDay.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.attendanceCompletenessRule.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.formativeScore.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.summativeScore.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.termExamScore.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.gradeComponentSubmission.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.gradeFinalResult.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.formativeAssessment.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.summativeAssessment.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.learningObjective.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.materialScope.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.gradeReportPolicy.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.curriculumPlacement.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.curriculum.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.teachingAssignment.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.homeroomAssignment.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.subject.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.school.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix03.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

function codeOf(response: { body: string }): string {
  return (JSON.parse(response.body) as { error: { code: string } }).error.code;
}

describe("nilai dan pengesahan rapor", { concurrency: 1 }, () => {
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

  it("menyimpan nilai 0, menolak nilai tidak sah, dan tidak menimpa nilai terkunci", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Nilai", npsn: "90110031", address: "Alamat uji" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Nilai Lain", npsn: "90110032", address: "Alamat lain" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const schoolClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10, fase: "E" } });
    const guruUser = await prisma.user.create({ data: { email: "guru.nilai@fix03.uji.local", name: "Guru Nilai", passwordHash: await hashPassword(PASSWORD) } });
    const otherUser = await prisma.user.create({ data: { email: "guru.nilai.lain@fix03.uji.local", name: "Guru Lain", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: guruUser.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: otherUser.id, roleCode: "GURU_MAPEL", schoolId: other.id });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, userId: guruUser.id, name: "Guru Nilai", gender: "LAKI_LAKI" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "MTK", name: "Matematika", category: "UMUM" } });
    const assignment = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: schoolClass.id, academicPeriodId: period.id },
    });
    const objective = await prisma.learningObjective.create({
      data: { schoolId: school.id, teachingAssignmentId: assignment.id, code: "TP 1", description: "Tujuan satu", sequence: 1 },
    });
    const scored = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011003101", nis: "01", name: "Budi Santoso", gender: "LAKI_LAKI" } });
    const blank = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011003102", nis: "02", name: "Ani Wijaya", gender: "PEREMPUAN" } });
    const outsider = await prisma.student.create({ data: { schoolId: other.id, nisn: "9011003201", nis: "09", name: "Siswa Luar", gender: "LAKI_LAKI" } });
    const token = await tokenFor(guruUser.email);
    const url = `/api/v1/schools/${school.id}/teaching-assignments/${assignment.id}/scores`;
    const headers = { authorization: `Bearer ${token}` };

    const zero = await app.inject({
      method: "PATCH",
      url,
      headers,
      payload: { formative: [{ learningObjectiveId: objective.id, studentId: scored.id, uh: 0 }] },
    });
    assert.equal(zero.statusCode, 200, zero.body);
    const stored = await prisma.formativeScore.findFirstOrThrow({ where: { studentId: scored.id } });
    assert.equal(Number(stored.uh), 0);
    const untouched = await prisma.formativeScore.findFirst({ where: { studentId: blank.id } });
    assert.equal(untouched, null);

    const invalid = await app.inject({
      method: "PATCH",
      url,
      headers,
      payload: { formative: [{ learningObjectiveId: objective.id, studentId: scored.id, uh: 101 }] },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(Number((await prisma.formativeScore.findFirstOrThrow({ where: { studentId: scored.id } })).uh), 0);

    const foreignStudent = await app.inject({
      method: "PATCH",
      url,
      headers,
      payload: { formative: [{ learningObjectiveId: objective.id, studentId: outsider.id, uh: 80 }] },
    });
    assert.equal(foreignStudent.statusCode, 400, foreignStudent.body);
    const otherToken = await tokenFor(otherUser.email);
    const denied = await app.inject({
      method: "PATCH",
      url,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { formative: [{ learningObjectiveId: objective.id, studentId: scored.id, uh: 10 }] },
    });
    assert.equal(denied.statusCode, 403, denied.body);

    await prisma.gradeComponentSubmission.create({
      data: {
        schoolId: school.id,
        teachingAssignmentId: assignment.id,
        componentKey: `f:uh:${objective.id}`,
        kind: "FORMATIVE",
        field: "UH",
        learningObjectiveId: objective.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: guruUser.id,
      },
    });
    const locked = await app.inject({
      method: "PATCH",
      url,
      headers,
      payload: { formative: [{ learningObjectiveId: objective.id, studentId: scored.id, uh: 10 }] },
    });
    assert.equal(locked.statusCode, 409, locked.body);
    assert.equal(codeOf(locked), "GRADE_LOCKED");
    assert.equal(Number((await prisma.formativeScore.findFirstOrThrow({ where: { studentId: scored.id } })).uh), 0);
  });

  it("menolak rapor belum lengkap, akses sekolah lain, dan pengesahan ganda", async () => {
    const school = await prisma.school.create({
      data: { name: "SMK Rapor", npsn: "90110031", address: "Alamat uji", principalName: "Kepala Uji" },
      select: { id: true },
    });
    const other = await prisma.school.create({ data: { name: "SMK Rapor Lain", npsn: "90110032", address: "Alamat lain" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z") },
    });
    const period = await prisma.academicPeriod.create({
      data: {
        schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL",
        startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"),
        reportDate: new Date("2026-11-19T00:00:00.000Z"), isActive: true,
      },
    });
    const curriculum = await prisma.curriculum.create({ data: { schoolId: school.id, academicYearId: year.id, code: "KUMER", name: "KUMER1" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "TKJ001", name: "KJD", category: "KEJURUAN" } });
    const schoolClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10, fase: "E" } });
    const waliUser = await prisma.user.create({ data: { email: "wali.rapor@fix03.uji.local", name: "Siti", passwordHash: await hashPassword(PASSWORD) } });
    const guruUser = await prisma.user.create({ data: { email: "guru.rapor@fix03.uji.local", name: "TOJI", passwordHash: await hashPassword(PASSWORD) } });
    const wakakurUser = await prisma.user.create({ data: { email: "wakakur.rapor@fix03.uji.local", name: "Wakakur Uji", passwordHash: await hashPassword(PASSWORD) } });
    const kepalaUser = await prisma.user.create({ data: { email: "kepala.rapor@fix03.uji.local", name: "Kepala Uji", passwordHash: await hashPassword(PASSWORD) } });
    const neighbor = await prisma.user.create({ data: { email: "wakakur.rapor.lain@fix03.uji.local", name: "Wakakur Lain", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: waliUser.id, roleCode: "WALI_KELAS", schoolId: school.id });
    await grantAssignment(prisma, { userId: guruUser.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: wakakurUser.id, roleCode: "WAKAKUR", schoolId: school.id });
    await grantAssignment(prisma, { userId: kepalaUser.id, roleCode: "KEPALA_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: neighbor.id, roleCode: "WAKAKUR", schoolId: other.id });
    const guru = await prisma.teacher.create({ data: { schoolId: school.id, userId: guruUser.id, name: "TOJI", gender: "LAKI_LAKI" } });
    const wali = await prisma.teacher.create({ data: { schoolId: school.id, userId: waliUser.id, name: "Siti", gender: "PEREMPUAN" } });
    const assignment = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: guru.id, subjectId: subject.id, classId: schoolClass.id, academicPeriodId: period.id },
    });
    const homeroom = await prisma.homeroomAssignment.create({ data: { schoolId: school.id, teacherId: wali.id, classId: schoolClass.id, academicPeriodId: period.id } });
    await prisma.curriculumPlacement.create({ data: { schoolId: school.id, curriculumId: curriculum.id, classId: schoolClass.id, subjectId: subject.id } });
    const objective = await prisma.learningObjective.create({
      data: { schoolId: school.id, teachingAssignmentId: assignment.id, curriculumId: curriculum.id, code: "TP1", description: "Tujuan", sequence: 1 },
    });
    const formative = await prisma.formativeAssessment.create({ data: { schoolId: school.id, learningObjectiveId: objective.id } });
    const scope = await prisma.materialScope.create({
      data: { schoolId: school.id, teachingAssignmentId: assignment.id, curriculumId: curriculum.id, code: "LM1", description: "Lingkup", sequence: 1 },
    });
    const summative = await prisma.summativeAssessment.create({ data: { schoolId: school.id, materialScopeId: scope.id } });
    const lengkap = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011003101", nis: "01", name: "Siswa Lengkap", gender: "LAKI_LAKI" } });
    const belum = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011003102", nis: "02", name: "Siswa Belum", gender: "PEREMPUAN" } });
    for (const studentId of [lengkap.id, belum.id]) {
      await prisma.formativeScore.create({ data: { schoolId: school.id, formativeAssessmentId: formative.id, studentId, uh: 80 } });
      await prisma.summativeScore.create({ data: { schoolId: school.id, summativeAssessmentId: summative.id, studentId, score: 70 } });
      await prisma.termExamScore.create({ data: { schoolId: school.id, teachingAssignmentId: assignment.id, studentId, sts: 90, sas: 100 } });
    }
    await prisma.gradeReportPolicy.create({
      data: {
        schoolId: school.id, academicYearId: year.id, academicPeriodId: period.id, curriculumId: curriculum.id, status: "ACTIVE",
        useFormative: true, useSummative: true, useSts: true, useSas: true, formativeMode: "COMBINED",
        weightFormative: 30, weightSummative: 30, weightSts: 20, weightSas: 20,
        remedialPolicy: "HIGHEST", emptyTreatment: "INCOMPLETE", roundingMode: "INTEGER",
      },
    });
    for (const row of [
      { componentKey: `f:uh:${objective.id}`, kind: "FORMATIVE" as const, field: "UH" as const },
      { componentKey: `s:${scope.id}`, kind: "SUMMATIVE" as const, field: "SCORE" as const },
      { componentKey: "sts", kind: "STS" as const, field: "STS" as const },
      { componentKey: "sas", kind: "SAS" as const, field: "SAS" as const },
    ]) {
      await prisma.gradeComponentSubmission.create({ data: { schoolId: school.id, teachingAssignmentId: assignment.id, ...row, status: "SUBMITTED" } });
    }
    const rule = await prisma.attendanceCompletenessRule.create({
      data: { schoolId: school.id, academicPeriodId: period.id, status: "ACTIVE", activatedAt: new Date(), activatedById: wakakurUser.id },
    });
    await prisma.attendanceCalendarDay.create({ data: { schoolId: school.id, ruleId: rule.id, date: new Date("2026-11-19T00:00:00.000Z"), kind: "PEMBELAJARAN" } });
    await prisma.dailyAttendance.create({
      data: {
        schoolId: school.id, homeroomAssignmentId: homeroom.id, attendanceDate: new Date("2026-11-19T00:00:00.000Z"),
        status: "FINAL", finalizedAt: new Date(), finalizedById: waliUser.id, createdById: waliUser.id,
        records: { create: [lengkap.id, belum.id].map((studentId) => ({ schoolId: school.id, studentId, status: "HADIR" as const })) },
      },
    });
    await prisma.studentReportActivity.create({
      data: { schoolId: school.id, studentId: lengkap.id, academicPeriodId: period.id, pklText: "PKL bengkel jaringan selama semester ini.", extracurricularText: "Pramuka dan rohani." },
    });
    const guruToken = await tokenFor(guruUser.email);
    const waliToken = await tokenFor(waliUser.email);
    const wakakurToken = await tokenFor(wakakurUser.email);
    const kepalaToken = await tokenFor(kepalaUser.email);
    const neighborToken = await tokenFor(neighbor.email);
    const described = await app.inject({
      method: "PUT",
      url: `/api/v1/schools/${school.id}/competency-descriptions`,
      headers: { authorization: `Bearer ${guruToken}` },
      payload: { assignmentId: assignment.id, students: [{ studentId: lengkap.id, text: "Menunjukkan penguasaan tujuan pembelajaran dan lingkup materi." }, { studentId: belum.id, text: "Menunjukkan penguasaan tujuan pembelajaran dan lingkup materi." }] },
    });
    assert.equal(described.statusCode, 200, described.body);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/schools/${school.id}/competency-descriptions/submit`, headers: { authorization: `Bearer ${guruToken}` }, payload: { assignmentId: assignment.id } })).statusCode, 200);
    assert.equal((await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/homeroom-notes/finalize`,
      headers: { authorization: `Bearer ${waliToken}` },
      payload: { homeroomId: homeroom.id, studentId: lengkap.id, text: "Catatan resmi wali kelas untuk rapor siswa lengkap." },
    })).statusCode, 200);

    const filedIncomplete = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-examinations/submit`,
      headers: { authorization: `Bearer ${waliToken}` },
      payload: { homeroomId: homeroom.id, studentId: belum.id },
    });
    assert.equal(filedIncomplete.statusCode, 409, filedIncomplete.body);
    await prisma.reportCardWorkflow.create({
      data: {
        schoolId: school.id, studentId: belum.id, classId: schoolClass.id, homeroomAssignmentId: homeroom.id,
        academicYearId: year.id, academicPeriodId: period.id, status: "DIAJUKAN", fingerprint: "b".repeat(64),
        submittedAt: new Date(), submittedById: waliUser.id,
      },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-validations/decision`,
      headers: { authorization: `Bearer ${wakakurToken}` },
      payload: { studentId: belum.id, academicPeriodId: period.id, decision: "approve" },
    });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal((await prisma.reportCardWorkflow.findFirstOrThrow({ where: { studentId: belum.id } })).status, "DIAJUKAN");

    const cross = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-validations/decision`,
      headers: { authorization: `Bearer ${neighborToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "approve" },
    });
    assert.equal(cross.statusCode, 403, cross.body);

    assert.equal((await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-examinations/review`,
      headers: { authorization: `Bearer ${waliToken}` },
      payload: { homeroomId: homeroom.id, studentId: lengkap.id },
    })).statusCode, 200);
    assert.equal((await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-examinations/submit`,
      headers: { authorization: `Bearer ${waliToken}` },
      payload: { homeroomId: homeroom.id, studentId: lengkap.id },
    })).statusCode, 200);
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-validations/decision`,
      headers: { authorization: `Bearer ${wakakurToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "approve" },
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(await prisma.auditLog.count({ where: { schoolId: school.id, action: "REPORT_CARD_APPROVED", entityType: "ReportCardWorkflow" } }), 1);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-validations/decision`,
      headers: { authorization: `Bearer ${wakakurToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "approve" },
    });
    assert.equal(again.statusCode, 409, again.body);
    assert.equal((await prisma.reportCardWorkflow.findFirstOrThrow({ where: { studentId: lengkap.id } })).status, "DISETUJUI_WAKAKUR");
    const wrongRole = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-endorsements/decision`,
      headers: { authorization: `Bearer ${wakakurToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "endorse" },
    });
    assert.equal(wrongRole.statusCode, 403, wrongRole.body);
    const endorsed = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-endorsements/decision`,
      headers: { authorization: `Bearer ${kepalaToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "endorse" },
    });
    assert.equal(endorsed.statusCode, 200, endorsed.body);
    assert.equal(await prisma.auditLog.count({ where: { schoolId: school.id, action: "REPORT_CARD_ENDORSED" } }), 1);
    const endorsedAgain = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/report-endorsements/decision`,
      headers: { authorization: `Bearer ${kepalaToken}` },
      payload: { studentId: lengkap.id, academicPeriodId: period.id, decision: "endorse" },
    });
    assert.equal(endorsedAgain.statusCode, 409, endorsedAgain.body);
    assert.equal(await prisma.reportCardWorkflow.count({ where: { studentId: lengkap.id, status: "DISAHKAN" } }), 1);
  });
});
