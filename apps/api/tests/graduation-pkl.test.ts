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
    where: { npsn: { in: ["90110061", "90110062"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.reportCardWorkflow.updateMany({ where: { schoolId: { in: ids } }, data: { activeSnapshotId: null } });
    await prisma.reportCardSnapshot.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.reportCardWorkflow.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.gradeFinalResult.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.studentReportActivity.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.internshipLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.internshipPlacement.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.alumniTracer.deleteMany({ where: { schoolId: { in: ids } } });
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
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix06.uji.local" } } });
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

describe("kelulusan alumni dan PKL rapor", { concurrency: 1 }, () => {
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

  it("memasukkan lebih dari 50 lulusan ke tracer tanpa menggandakan atau mengubah histori", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Lulus", npsn: "90110061" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Lulus Lain", npsn: "90110062" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Genap", semesterKind: "GENAP", startDate: new Date("2027-01-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const source = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "XII TKR 1", gradeLevel: 12 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Lulus", gender: "LAKI_LAKI" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "TKR", name: "Teknik Kendaraan", category: "KEJURUAN" } });
    const teaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: source.id, academicPeriodId: period.id },
    });
    const identity = await prisma.student.create({
      data: { schoolId: school.id, classId: source.id, nisn: "9011061001", nis: "L-01", name: "Alumni Tetap", gender: "PEREMPUAN", birthPlace: "Lampung" },
    });
    await prisma.student.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        schoolId: school.id,
        classId: source.id,
        nisn: String(9011061002 + index),
        name: index < 2 ? "Nama Sama" : `Lulusan ${index + 2}`,
        gender: "LAKI_LAKI" as const,
      })),
    });
    const outsider = await prisma.student.create({ data: { schoolId: other.id, classId: null, nisn: "9011061999", name: "Siswa Sekolah Lain", gender: "LAKI_LAKI" } });
    const grade = await prisma.gradeFinalResult.create({
      data: { schoolId: school.id, teachingAssignmentId: teaching.id, studentId: identity.id, score: "88.5000", formula: "rata-rata", detail: { source: "uji" }, savedById: teacher.id },
    });
    await prisma.alumniTracer.create({
      data: { schoolId: school.id, alumniName: "Alumni Tetap", graduationYear: 2027, majorName: "XII TKR 1", status: "KULIAH" },
    });
    const admin = await prisma.user.create({ data: { email: "admin@fix06.uji.local", name: "Admin Lulus", passwordHash: await hashPassword(PASSWORD) } });
    const guru = await prisma.user.create({ data: { email: "guru@fix06.uji.local", name: "Guru Lulus", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    const students = await prisma.student.findMany({ where: { schoolId: school.id, classId: source.id }, select: { id: true } });
    assert.equal(students.length, 51);
    const payload = { mode: "GRADUATE", sourceClassId: source.id, graduationYear: 2027, studentIds: [...students.map((student) => student.id), outsider.id] };

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${await tokenFor(guru.email)}` },
      payload,
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(await prisma.alumniTracer.count({ where: { schoolId: school.id } }), 1);
    assert.equal((await prisma.alumniTracer.findFirstOrThrow({ where: { schoolId: school.id, alumniName: "Alumni Tetap" } })).studentId, null);

    const graduated = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${await tokenFor(admin.email)}` },
      payload,
    });
    assert.equal(graduated.statusCode, 200, graduated.body);
    const body = JSON.parse(graduated.body) as { succeeded: Array<{ studentId: string }>; failed: Array<{ studentId: string }> };
    assert.equal(body.succeeded.length, 51);
    assert.equal(body.failed.some((item) => item.studentId === outsider.id), true);
    assert.equal(await prisma.alumniTracer.count({ where: { schoolId: school.id } }), 52);
    const legacy = await prisma.alumniTracer.findFirstOrThrow({ where: { schoolId: school.id, alumniName: "Alumni Tetap", studentId: null } });
    assert.equal(legacy.status, "KULIAH");
    const linkedIdentity = await prisma.alumniTracer.findFirstOrThrow({ where: { schoolId: school.id, studentId: identity.id, graduationYear: 2027 } });
    assert.notEqual(linkedIdentity.id, legacy.id);
    const twins = await prisma.student.findMany({ where: { schoolId: school.id, name: "Nama Sama" }, select: { id: true } });
    assert.equal(twins.length, 2);
    const twinTracers = await prisma.alumniTracer.findMany({ where: { schoolId: school.id, studentId: { in: twins.map((student) => student.id) } } });
    assert.equal(twinTracers.length, 2);
    assert.notEqual(twinTracers[0]?.studentId, twinTracers[1]?.studentId);
    assert.equal(await prisma.alumniTracer.count({ where: { schoolId: other.id } }), 0);
    await assert.rejects(() => prisma.alumniTracer.create({
      data: { schoolId: school.id, studentId: identity.id, alumniName: "Alumni Tetap", graduationYear: 2027, majorName: "XII TKR 1", status: "BELUM_BEKERJA" },
    }));

    const kept = await prisma.student.findUniqueOrThrow({ where: { id: identity.id } });
    assert.equal(kept.nisn, "9011061001");
    assert.equal(kept.name, "Alumni Tetap");
    assert.equal(kept.schoolId, school.id);
    assert.equal(kept.birthPlace, "Lampung");
    assert.equal(kept.isActive, false);
    assert.equal(kept.classId, null);
    const storedGrade = await prisma.gradeFinalResult.findUniqueOrThrow({ where: { id: grade.id } });
    assert.equal(storedGrade.score.toString(), "88.5");

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/student-transitions`,
      headers: { authorization: `Bearer ${await tokenFor(admin.email)}` },
      payload,
    });
    assert.equal(again.statusCode, 200, again.body);
    const repeated = JSON.parse(again.body) as { succeeded: unknown[] };
    assert.equal(repeated.succeeded.length, 0);
    assert.equal(await prisma.alumniTracer.count({ where: { schoolId: school.id } }), 52);
    assert.equal(await prisma.auditLog.count({ where: { schoolId: school.id, action: "ALUMNI_TRACER_FROM_GRADUATION", entityId: identity.id } }), 1);
  });

  it("menampilkan PKL sesuai sekolah dan periode tanpa mengubah rapor yang sudah disahkan", async () => {
    const { readEnrichedHomeroomPreview } = await import("../src/modules/academic/report-card/preview.service.ts");
    const school = await prisma.school.create({ data: { name: "SMK PKL", npsn: "90110061" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK PKL Lain", npsn: "90110062" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const otherYear = await prisma.academicYear.create({
      data: { schoolId: other.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z") },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const schoolClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "XI TKR 1", gradeLevel: 11, fase: "F" } });
    const otherClass = await prisma.schoolClass.create({ data: { schoolId: other.id, academicYearId: otherYear.id, name: "XI Asing", gradeLevel: 11 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Wali PKL", gender: "LAKI_LAKI" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "PRD", name: "Produktif", category: "KEJURUAN" } });
    const teaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: schoolClass.id, academicPeriodId: period.id },
    });
    const homeroom = await prisma.homeroomAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, classId: schoolClass.id, academicPeriodId: period.id },
    });
    const matched = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011061101", name: "Siswa PKL", gender: "LAKI_LAKI" } });
    const manual = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011061102", name: "Siswa Catatan", gender: "PEREMPUAN" } });
    const empty = await prisma.student.create({ data: { schoolId: school.id, classId: schoolClass.id, nisn: "9011061103", name: "Siswa Kosong", gender: "LAKI_LAKI" } });
    const foreign = await prisma.student.create({ data: { schoolId: other.id, classId: otherClass.id, nisn: "9011061199", name: "Siswa Luar", gender: "LAKI_LAKI" } });
    await prisma.internshipPlacement.createMany({
      data: [
        { schoolId: school.id, studentId: matched.id, companyName: "Bengkel Utara", startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-11-30T00:00:00.000Z"), status: "AKTIF" },
        { schoolId: school.id, studentId: matched.id, companyName: "Bengkel Batal", startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-09-01T00:00:00.000Z"), status: "DIBATALKAN" },
        { schoolId: school.id, studentId: manual.id, companyName: "Bengkel Selatan", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), status: "SELESAI" },
        { schoolId: school.id, studentId: empty.id, companyName: "Bengkel Lama", startDate: new Date("2025-01-01T00:00:00.000Z"), endDate: new Date("2025-03-01T00:00:00.000Z"), status: "SELESAI" },
        { schoolId: other.id, studentId: foreign.id, companyName: "Bengkel Asing", startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-11-30T00:00:00.000Z"), status: "AKTIF" },
      ],
    });
    await prisma.studentReportActivity.create({
      data: { schoolId: school.id, studentId: manual.id, academicPeriodId: period.id, pklText: "Catatan manual PKL." },
    });
    const grade = await prisma.gradeFinalResult.create({
      data: { schoolId: school.id, teachingAssignmentId: teaching.id, studentId: matched.id, score: "77.0000", formula: "tetap", detail: { source: "uji" }, savedById: teacher.id },
    });

    const preview = await readEnrichedHomeroomPreview(prisma, school.id, homeroom.id);
    assert.ok(preview);
    const section = (studentId: string) => preview.students.find((student) => student.studentId === studentId)?.sections.find((item) => item.key === "pkl");
    const matchedPkl = section(matched.id);
    assert.equal(matchedPkl?.status, "SIAP");
    assert.match(matchedPkl?.value ?? "", /Bengkel Utara/);
    assert.equal((matchedPkl?.value ?? "").includes("Bengkel Batal"), false);
    assert.equal((matchedPkl?.value ?? "").includes("Bengkel Asing"), false);
    assert.equal(section(manual.id)?.value, "Catatan manual PKL.");
    assert.equal(section(empty.id)?.status, "BELUM_TERSEDIA");
    assert.equal(preview.students.some((student) => student.studentId === foreign.id), false);

    const officialText = "PKL yang sudah disahkan.";
    const workflow = await prisma.reportCardWorkflow.create({
      data: {
        schoolId: school.id,
        studentId: matched.id,
        classId: schoolClass.id,
        homeroomAssignmentId: homeroom.id,
        academicYearId: year.id,
        academicPeriodId: period.id,
        status: "DISAHKAN",
        fingerprint: "c".repeat(64),
        version: 1,
        endorsedAt: new Date("2026-12-20T00:00:00.000Z"),
        endorsedById: teacher.id,
      },
    });
    const snapshot = await prisma.reportCardSnapshot.create({
      data: {
        schoolId: school.id,
        workflowId: workflow.id,
        studentId: matched.id,
        academicPeriodId: period.id,
        version: 1,
        fingerprint: "c".repeat(64),
        payload: { sections: [{ key: "pkl", label: "PKL", status: "SIAP", value: officialText }] },
        endorsedById: teacher.id,
        endorsedAt: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    await prisma.reportCardWorkflow.update({ where: { id: workflow.id }, data: { activeSnapshotId: snapshot.id } });
    await prisma.internshipPlacement.create({
      data: { schoolId: school.id, studentId: matched.id, companyName: "Bengkel Baru", startDate: new Date("2026-08-15T00:00:00.000Z"), endDate: new Date("2026-12-15T00:00:00.000Z"), status: "AKTIF" },
    });

    const after = await readEnrichedHomeroomPreview(prisma, school.id, homeroom.id);
    assert.equal(after?.students.find((student) => student.studentId === matched.id)?.sections.find((item) => item.key === "pkl")?.value, officialText);
    const stored = await prisma.reportCardSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    assert.equal(JSON.stringify(stored.payload).includes(officialText), true);
    assert.equal(JSON.stringify(stored.payload).includes("Bengkel Baru"), false);
    assert.equal((await prisma.gradeFinalResult.findUniqueOrThrow({ where: { id: grade.id } })).score.toString(), "77");
  });
});
