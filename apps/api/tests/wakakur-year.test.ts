import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { AcademicOptionsDto } from "@sims/shared";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const OWNED_NPSN = ["90110091", "90110092", "90110093"];
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
process.env.DATABASE_URL = isolatedUrl;
process.env.NODE_ENV = "development";

let prisma: PrismaClient;
let app: FastifyInstance;
let grantAssignment: typeof import("../src/modules/access/assignments.ts").grantAssignment;
let hashPassword: typeof import("../src/lib/password.ts").hashPassword;

async function assertDatabase(client: PrismaClient, expected: string): Promise<void> {
  const rows = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (rows[0]?.name !== expected || BANNED_DATABASES.has(rows[0]?.name ?? "")) {
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
  const schools = await prisma.school.findMany({ where: { npsn: { in: OWNED_NPSN } }, select: { id: true } });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.curriculum.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix07.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 200);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

describe("tahun pelajaran wakakur", { concurrency: 1 }, () => {
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
    const application = await import("../src/app.ts");
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

  it("menampilkan tahun sekolah sendiri dan menolak pembuatan tahun oleh wakakur", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Tahun Uji", npsn: "90110091" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Tahun Lain", npsn: "90110092" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    await prisma.academicYear.create({
      data: { schoolId: other.id, name: "2025/2026", startDate: new Date("2025-07-01T00:00:00.000Z"), endDate: new Date("2026-06-30T00:00:00.000Z"), isActive: true },
    });
    const student = await prisma.student.create({
      data: { schoolId: school.id, nisn: "9011009101", name: "Siswa Tahun Uji", gender: "PEREMPUAN" },
    });
    const user = await prisma.user.create({
      data: { email: "wakakur@fix07.uji.local", name: "Wakakur Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: user.id, roleCode: "WAKAKUR", schoolId: school.id });
    const token = await tokenFor(user.email);
    const headers = { authorization: `Bearer ${token}` };

    const options = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/academic-options`, headers });
    assert.equal(options.statusCode, 200);
    const optionBody = JSON.parse(options.body) as { options: AcademicOptionsDto };
    assert.deepEqual(optionBody.options.years.map((item) => item.label), ["2026/2027"]);
    assert.equal(optionBody.options.years.some((item) => item.label === "2025/2026"), false);

    const listed = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/academic-years`, headers });
    assert.equal(listed.statusCode, 200);
    assert.equal((JSON.parse(listed.body) as { total: number }).total, 1);

    const foreign = await app.inject({ method: "GET", url: `/api/v1/schools/${other.id}/academic-options`, headers });
    assert.equal(foreign.statusCode, 403);

    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/academic-years`,
      headers,
      payload: { name: "2027/2028", startDate: "2027-07-01", endDate: "2028-06-30", isActive: false },
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(await prisma.academicYear.count({ where: { schoolId: school.id } }), 1);

    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/curricula`,
      headers,
      payload: { academicYearId: year.id, code: "KM-UJI", name: "Kurikulum Uji", description: null, isActive: true },
    });
    assert.equal(saved.statusCode, 201);
    assert.equal(await prisma.curriculum.count({ where: { schoolId: school.id, academicYearId: year.id, code: "KM-UJI" } }), 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).classId, null);

    const emptySchool = await prisma.school.create({ data: { name: "SMK Tanpa Tahun", npsn: "90110093" }, select: { id: true } });
    await grantAssignment(prisma, { userId: user.id, roleCode: "WAKAKUR", schoolId: emptySchool.id });
    const emptyToken = await tokenFor(user.email);
    const empty = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${emptySchool.id}/academic-options`,
      headers: { authorization: `Bearer ${emptyToken}` },
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual((JSON.parse(empty.body) as { options: AcademicOptionsDto }).options.years, []);
    assert.equal(await prisma.academicYear.count({ where: { schoolId: emptySchool.id } }), 0);

    const reads = await Promise.all([
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/semesters`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/expertise-fields`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/expertise-programs`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/expertise-concentrations`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/classes`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/subjects`, headers }),
      app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/teaching-assignments`, headers }),
    ]);
    assert.deepEqual(reads.map((response) => response.statusCode), [200, 200, 200, 200, 200, 200, 200]);
    const foreignYear = await app.inject({ method: "GET", url: `/api/v1/schools/${other.id}/academic-years`, headers });
    assert.equal(foreignYear.statusCode, 403);
  });

  it("admin sekolah tetap dapat membuat tahun pelajaran", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Admin Tahun", npsn: "90110091" }, select: { id: true } });
    const admin = await prisma.user.create({
      data: { email: "admin@fix07.uji.local", name: "Admin Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/academic-years`,
      headers: { authorization: `Bearer ${await tokenFor(admin.email)}` },
      payload: { name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isActive: true },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(await prisma.academicYear.count({ where: { schoolId: school.id, name: "2026/2027" } }), 1);
    const next = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/academic-years`,
      headers: { authorization: `Bearer ${await tokenFor(admin.email)}` },
      payload: { name: "2027/2028", startDate: "2027-07-01", endDate: "2028-06-30", isActive: false },
    });
    assert.equal(next.statusCode, 201);
    assert.equal(await prisma.academicYear.count({ where: { schoolId: school.id } }), 2);
  });

  it("menolak perubahan identitas tahun yang sudah dipakai dan tetap mengizinkan status", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Tahun Pakai", npsn: "90110091" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Tahun Asing", npsn: "90110092" }, select: { id: true } });
    const admin = await prisma.user.create({
      data: { email: "admin@fix07.uji.local", name: "Admin Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    const wakakur = await prisma.user.create({
      data: { email: "wakakur@fix07.uji.local", name: "Wakakur Uji", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: wakakur.id, roleCode: "WAKAKUR", schoolId: school.id });
    const adminHeaders = { authorization: `Bearer ${await tokenFor(admin.email)}` };
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/academic-years`,
      headers: adminHeaders,
      payload: { name: "2026/202", startDate: "2026-07-01", endDate: "2027-06-30", isActive: true },
    });
    assert.equal(created.statusCode, 201);
    const yearId = (JSON.parse(created.body) as { item: { id: string } }).item.id;
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/academic-years/${yearId}`,
      headers: adminHeaders,
      payload: { name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isActive: true },
    });
    assert.equal(renamed.statusCode, 200);
    const room = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: yearId, name: "X TSM 1", gradeLevel: 10, capacity: 36 },
    });
    const student = await prisma.student.create({
      data: { schoolId: school.id, nisn: "9011009102", name: "Siswa Tahun Pakai", gender: "LAKI_LAKI", classId: room.id },
    });
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/academic-years/${yearId}`,
      headers: adminHeaders,
      payload: { name: "2028/2029", startDate: "2026-07-01", endDate: "2027-06-30", isActive: true },
    });
    assert.equal(blocked.statusCode, 409);
    assert.match((JSON.parse(blocked.body) as { error: { message: string } }).error.message, /kelas/);
    assert.equal((await prisma.academicYear.findUniqueOrThrow({ where: { id: yearId } })).name, "2026/2027");
    const status = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/academic-years/${yearId}`,
      headers: adminHeaders,
      payload: { name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isActive: false },
    });
    assert.equal(status.statusCode, 200);
    assert.equal((await prisma.academicYear.findUniqueOrThrow({ where: { id: yearId } })).isActive, false);
    assert.equal(await prisma.schoolClass.count({ where: { id: room.id, academicYearId: yearId } }), 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).classId, room.id);
    assert.equal(await prisma.gradeFinalResult.count({ where: { schoolId: school.id } }), 0);
    const wakakurHeaders = { authorization: `Bearer ${await tokenFor(wakakur.email)}` };
    const read = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/academic-years`, headers: wakakurHeaders });
    assert.equal(read.statusCode, 200);
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/academic-years`,
      headers: wakakurHeaders,
      payload: { name: "2029/2030", startDate: "2029-07-01", endDate: "2030-06-30", isActive: false },
    });
    assert.equal(denied.statusCode, 403);
    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${other.id}/academic-years/${yearId}`,
      headers: adminHeaders,
      payload: { name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30", isActive: false },
    });
    assert.equal(foreign.statusCode, 403);
  });
});
