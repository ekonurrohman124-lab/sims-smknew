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
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${TARGET_DATABASE}"`);
  } finally {
    await admin.$disconnect();
  }
}

async function wipeOwnedRows(): Promise<void> {
  await assertDatabase(prisma, TARGET_DATABASE);
  const schools = await prisma.school.findMany({
    where: { npsn: { in: ["90110011", "90110012"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.learningObjective.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.materialScope.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.curriculumPlacement.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.curriculum.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teachingAssignment.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.subject.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix02.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

function errorCode(response: { body: string }): string {
  return (JSON.parse(response.body) as { error: { code: string } }).error.code;
}

describe("penugasan dan salin TP/LM", { concurrency: 1 }, () => {
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

  it("membedakan duplikat penugasan dari kegagalan dan menolak sekolah lain", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Penugasan", npsn: "90110011" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Penugasan Lain", npsn: "90110012" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const otherYear = await prisma.academicYear.create({
      data: { schoolId: other.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z") },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const otherPeriod = await prisma.academicPeriod.create({
      data: { schoolId: other.id, academicYearId: otherYear.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z") },
    });
    const classA = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10 } });
    const classB = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 2", gradeLevel: 10 } });
    const foreignClass = await prisma.schoolClass.create({ data: { schoolId: other.id, academicYearId: otherYear.id, name: "X Asing", gradeLevel: 10 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Penugasan", gender: "LAKI_LAKI" } });
    const foreignTeacher = await prisma.teacher.create({ data: { schoolId: other.id, name: "Guru Asing", gender: "PEREMPUAN" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "MTK", name: "Matematika", category: "UMUM" } });
    const admin = await prisma.user.create({ data: { email: "admin.tugas@fix02.uji.local", name: "Admin Penugasan", passwordHash: await hashPassword(PASSWORD) } });
    const guru = await prisma.user.create({ data: { email: "guru.tugas@fix02.uji.local", name: "Guru Penugasan", passwordHash: await hashPassword(PASSWORD) } });
    const outsider = await prisma.user.create({ data: { email: "admin.lain@fix02.uji.local", name: "Admin Lain", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: outsider.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    const token = await tokenFor(admin.email);
    const payload = { teacherId: teacher.id, subjectId: subject.id, classId: classA.id, academicPeriodId: period.id };

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(created.statusCode, 201, created.body);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, teacherId: teacher.id },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(errorCode(duplicate), "DUPLICATE");
    assert.equal(await prisma.teachingAssignment.count({ where: { schoolId: school.id, classId: classA.id, subjectId: subject.id, academicPeriodId: period.id } }), 1);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { teacherId: teacher.id, subjectId: subject.id, classId: classB.id },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.notEqual(errorCode(invalid), "DUPLICATE");
    assert.equal(await prisma.teachingAssignment.count({ where: { classId: classB.id } }), 0);

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, classId: foreignClass.id, teacherId: foreignTeacher.id, academicPeriodId: otherPeriod.id },
    });
    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.notEqual(errorCode(foreign), "DUPLICATE");
    assert.equal(await prisma.teachingAssignment.count({ where: { schoolId: other.id } }), 0);

    const guruToken = await tokenFor(guru.email);
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${guruToken}` },
      payload: { ...payload, classId: classB.id },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    const otherToken = await tokenFor(outsider.email);
    const deniedSchool = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teaching-assignments`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload,
    });
    assert.equal(deniedSchool.statusCode, 403, deniedSchool.body);
    assert.equal(await prisma.teachingAssignment.count({ where: { schoolId: school.id } }), 1);
  });

  it("memuat lebih dari 50 TP/LM berurutan dan menolak salinan yang gagal", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Rencana", npsn: "90110011" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Rencana Lain", npsn: "90110012" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const otherYear = await prisma.academicYear.create({
      data: { schoolId: other.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z") },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const sourceClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 1", gradeLevel: 10 } });
    const targetClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "X TKJ 2", gradeLevel: 10 } });
    const foreignClass = await prisma.schoolClass.create({ data: { schoolId: other.id, academicYearId: otherYear.id, name: "X Asing", gradeLevel: 10 } });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Guru Rencana", gender: "LAKI_LAKI" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.id, code: "KJD", name: "Konsentrasi", category: "KEJURUAN" } });
    const sourceTeaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: sourceClass.id, academicPeriodId: period.id },
    });
    const targetTeaching = await prisma.teachingAssignment.create({
      data: { schoolId: school.id, teacherId: teacher.id, subjectId: subject.id, classId: targetClass.id, academicPeriodId: period.id },
    });
    const curriculum = await prisma.curriculum.create({
      data: { schoolId: school.id, academicYearId: year.id, code: "K25", name: "Kurikulum Uji", isActive: true },
    });
    await prisma.curriculumPlacement.createMany({
      data: [sourceClass.id, targetClass.id].map((classId) => ({ schoolId: school.id, curriculumId: curriculum.id, classId, subjectId: subject.id })),
    });
    await prisma.learningObjective.createMany({
      data: Array.from({ length: 51 }, (_, index) => {
        const sequence = 51 - index;
        return {
          schoolId: school.id,
          teachingAssignmentId: sourceTeaching.id,
          curriculumId: curriculum.id,
          code: `TP-${String(sequence).padStart(3, "0")}`,
          description: `Tujuan pembelajaran ${sequence}`,
          sequence,
        };
      }),
    });
    await prisma.materialScope.createMany({
      data: Array.from({ length: 51 }, (_, index) => {
        const sequence = index + 1;
        return {
          schoolId: school.id,
          teachingAssignmentId: sourceTeaching.id,
          curriculumId: curriculum.id,
          code: `LM-${String(sequence).padStart(3, "0")}`,
          description: `Lingkup materi ${sequence}`,
          sequence,
        };
      }),
    });
    const admin = await prisma.user.create({ data: { email: "admin.rencana@fix02.uji.local", name: "Admin Rencana", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "WAKAKUR", schoolId: school.id });
    const token = await tokenFor(admin.email);
    const headers = { authorization: `Bearer ${token}` };

    async function fetchAll(path: string, classId: string) {
      const items: Array<{ id: string; code: string; sequence: number; description: string }> = [];
      let total = Number.POSITIVE_INFINITY;
      for (let page = 1; items.length < total && page <= 5; page += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/schools/${school.id}/${path}?classId=${classId}&subjectId=${subject.id}&academicPeriodId=${period.id}&page=${page}&pageSize=50`,
          headers,
        });
        assert.equal(response.statusCode, 200, response.body);
        const body = JSON.parse(response.body) as { items: typeof items; total: number };
        total = body.total;
        items.push(...body.items);
        if (body.items.length === 0) break;
      }
      return { items, total };
    }

    const rejected = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/learning-objectives?classId=${sourceClass.id}&subjectId=${subject.id}&academicPeriodId=${period.id}&page=1&pageSize=100`,
      headers,
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    const objectives = await fetchAll("learning-objectives", sourceClass.id);
    const scopes = await fetchAll("material-scopes", sourceClass.id);
    assert.equal(objectives.total, 51);
    assert.equal(scopes.total, 51);
    assert.deepEqual(objectives.items.map((item) => item.sequence), Array.from({ length: 51 }, (_, index) => index + 1));
    assert.deepEqual(scopes.items.map((item) => item.code), Array.from({ length: 51 }, (_, index) => `LM-${String(index + 1).padStart(3, "0")}`));
    assert.equal(new Set(objectives.items.map((item) => item.id)).size, 51);

    for (const item of objectives.items) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/schools/${school.id}/learning-objectives`,
        headers,
        payload: { classId: targetClass.id, subjectId: subject.id, academicPeriodId: period.id, code: item.code, description: item.description, sequence: item.sequence },
      });
      assert.equal(response.statusCode, 201, response.body);
    }
    for (const item of scopes.items) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/schools/${school.id}/material-scopes`,
        headers,
        payload: { classId: targetClass.id, subjectId: subject.id, academicPeriodId: period.id, code: item.code, description: item.description, sequence: item.sequence },
      });
      assert.equal(response.statusCode, 201, response.body);
    }

    const copied = await prisma.learningObjective.findMany({
      where: { teachingAssignmentId: targetTeaching.id },
      orderBy: [{ sequence: "asc" }, { code: "asc" }],
    });
    assert.equal(copied.length, 51);
    assert.deepEqual(copied.map((item) => item.code), objectives.items.map((item) => item.code));
    assert.ok(copied.every((item) => item.schoolId === school.id && item.curriculumId === curriculum.id && item.teachingAssignmentId === targetTeaching.id));
    const copiedScopes = await prisma.materialScope.count({ where: { teachingAssignmentId: targetTeaching.id, schoolId: school.id, curriculumId: curriculum.id } });
    assert.equal(copiedScopes, 51);

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/learning-objectives`,
      headers,
      payload: { classId: targetClass.id, subjectId: subject.id, academicPeriodId: period.id, code: "TP-001", description: "Tujuan pembelajaran 1", sequence: 1 },
    });
    assert.equal(again.statusCode, 409, again.body);
    assert.equal(errorCode(again), "DUPLICATE");
    assert.equal(await prisma.learningObjective.count({ where: { teachingAssignmentId: targetTeaching.id, code: "TP-001" } }), 1);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/learning-objectives`,
      headers,
      payload: { classId: targetClass.id, subjectId: subject.id, academicPeriodId: period.id, code: "TP-052", description: "x" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.notEqual(errorCode(invalid), "DUPLICATE");

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/material-scopes`,
      headers,
      payload: { classId: foreignClass.id, subjectId: subject.id, academicPeriodId: period.id, code: "LM-001", description: "Lingkup materi 1", sequence: 1 },
    });
    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.equal(await prisma.materialScope.count({ where: { schoolId: other.id } }), 0);
    assert.equal(await prisma.learningObjective.count({ where: { schoolId: school.id } }), 102);
  });
});
