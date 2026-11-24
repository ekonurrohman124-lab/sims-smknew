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
    where: { npsn: { in: ["90110041", "90110042"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.payrollSlip.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.payrollPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.ppdbApplicant.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.anonymousReport.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix04.uji.local" } } });
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

function errorCode(body: string): string {
  return (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? "";
}

describe("payroll, PPDB, dan portal aduan", { concurrency: 1 }, () => {
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

  it("menghitung slip sekali, menolak generate ulang, dan menolak sekolah atau peran lain", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Payroll", npsn: "90110041" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Payroll Lain", npsn: "90110042" }, select: { id: true } });
    const admin = await prisma.user.create({
      data: { email: "admin@fix04.uji.local", name: "Admin Payroll", passwordHash: await hashPassword(PASSWORD) },
    });
    const guru = await prisma.user.create({
      data: { email: "guru@fix04.uji.local", name: "Guru Payroll", passwordHash: await hashPassword(PASSWORD) },
    });
    const outsider = await prisma.user.create({
      data: { email: "admin.lain@fix04.uji.local", name: "Admin Lain", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: outsider.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    const token = await tokenFor(admin.email);
    const guruToken = await tokenFor(guru.email);
    const outsiderToken = await tokenFor(outsider.email);

    const missingPrefix = await app.inject({
      method: "GET",
      url: `/schools/${school.id}/payroll/periods`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(missingPrefix.statusCode, 404);
    assert.equal(errorCode(missingPrefix.body), "NOT_FOUND");

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/payroll/periods`,
      headers: { authorization: `Bearer ${token}` },
      payload: { month: 13, year: 2026, ratePerJtm: 35000, ratePerHadir: 25000 },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(errorCode(invalid.body), "VALIDATION_ERROR");
    assert.equal(invalid.body.includes("stack"), false);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/payroll/periods`,
      headers: { authorization: `Bearer ${token}` },
      payload: { month: 11, year: 2026, ratePerJtm: 35000, ratePerHadir: 25000 },
    });
    assert.equal(created.statusCode, 200, created.body);
    const period = JSON.parse(created.body) as { id: string; title: string };
    assert.match(period.title, /November 2026/);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/payroll/periods`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal((JSON.parse(listed.body) as Array<{ id: string }>).some((item) => item.id === period.id), true);

    const deniedGuru = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/payroll/periods`,
      headers: { authorization: `Bearer ${guruToken}` },
    });
    assert.equal(deniedGuru.statusCode, 403);
    const deniedSchool = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/payroll/periods/${period.id}/generate`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    assert.equal(deniedSchool.statusCode, 403);

    const generated = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/payroll/periods/${period.id}/generate`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(generated.statusCode, 200, generated.body);
    const slips = JSON.parse(generated.body) as Array<{ id: string; userId: string; netPay: number }>;
    assert.equal(slips.length, 2);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/payroll/periods/${period.id}/generate`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(again.statusCode, 409);
    assert.equal(errorCode(again.body), "PAYROLL_ALREADY_GENERATED");
    assert.equal(await prisma.payrollSlip.count({ where: { periodId: period.id } }), 2);
    const firstNet = slips[0]?.netPay;
    const stored = await prisma.payrollSlip.findUniqueOrThrow({ where: { id: slips[0]!.id } });
    assert.equal(stored.netPay, firstNet);

    const slipList = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/payroll/periods/${period.id}/slips`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(slipList.statusCode, 200, slipList.body);
    assert.equal((JSON.parse(slipList.body) as Array<{ userId: string }>).length, 2);
    const mine = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/payroll/my-slips`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal((JSON.parse(mine.body) as unknown[]).length, 0);
  });

  it("menyimpan PPDB setelah validasi dan menolak pengiriman ganda serta sekolah lain", async () => {
    const school = await prisma.school.create({ data: { name: "SMK PPDB", npsn: "90110041" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK PPDB Lain", npsn: "90110042" }, select: { id: true } });
    const admin = await prisma.user.create({
      data: { email: "ppdb@fix04.uji.local", name: "Admin PPDB", passwordHash: await hashPassword(PASSWORD) },
    });
    const outsider = await prisma.user.create({
      data: { email: "ppdb.lain@fix04.uji.local", name: "Admin PPDB Lain", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: outsider.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    const token = await tokenFor(admin.email);
    const outsiderToken = await tokenFor(outsider.email);
    const payload = {
      fullName: "Calon Siswa Uji",
      originSchool: "SMP Contoh",
      chosenMajor: "Teknik Komputer",
      parentPhone: "08123456789",
      averageScore: 80,
    };

    const missingPrefix = await app.inject({
      method: "POST",
      url: `/schools/${school.id}/ppdb/applicants`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(missingPrefix.statusCode, 404);
    assert.equal(await prisma.ppdbApplicant.count({ where: { schoolId: school.id } }), 0);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/ppdb/applicants`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, fullName: "A" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(errorCode(invalid.body), "VALIDATION_ERROR");
    assert.equal(await prisma.ppdbApplicant.count({ where: { schoolId: school.id } }), 0);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/ppdb/applicants`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(created.statusCode, 200, created.body);
    const first = JSON.parse(created.body) as { id: string; registrationNo: string; status: string };
    assert.match(first.registrationNo, /^PPDB-/);
    assert.equal(first.status, "MENDAFTAR");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/ppdb/applicants`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    const second = JSON.parse(duplicate.body) as { id: string; registrationNo: string };
    assert.equal(second.id, first.id);
    assert.equal(second.registrationNo, first.registrationNo);
    assert.equal(await prisma.ppdbApplicant.count({ where: { schoolId: school.id } }), 1);

    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/ppdb/applicants`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    assert.equal(denied.statusCode, 403);
  });

  it("menyimpan aduan anonim tanpa identitas pelapor dan menolak peran atau sekolah yang tidak berwenang", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Aduan", npsn: "90110041" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Aduan Lain", npsn: "90110042" }, select: { id: true } });
    const guru = await prisma.user.create({
      data: { email: "pelapor@fix04.uji.local", name: "Guru Pelapor", passwordHash: await hashPassword(PASSWORD) },
    });
    const outsider = await prisma.user.create({
      data: { email: "pelapor.lain@fix04.uji.local", name: "Guru Lain", passwordHash: await hashPassword(PASSWORD) },
    });
    await grantAssignment(prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await grantAssignment(prisma, { userId: outsider.id, roleCode: "GURU_MAPEL", schoolId: other.id });
    const token = await tokenFor(guru.email);
    const outsiderToken = await tokenFor(outsider.email);
    const payload = {
      category: "PERUNDUNGAN_BULLYING",
      incidentPlace: "Kantin",
      description: "Terjadi perundungan berulang di kantin sekolah.",
    };

    const missingPrefix = await app.inject({
      method: "POST",
      url: `/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(missingPrefix.statusCode, 404);
    assert.equal(await prisma.anonymousReport.count({ where: { schoolId: school.id } }), 0);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, description: "pendek" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(errorCode(invalid.body), "VALIDATION_ERROR");
    assert.equal(invalid.body.includes("stack"), false);
    assert.equal(await prisma.anonymousReport.count({ where: { schoolId: school.id } }), 0);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(created.statusCode, 200, created.body);
    const report = JSON.parse(created.body) as { id: string; ticketCode: string };
    assert.match(report.ticketCode, /^SAFE-/);
    for (const key of ["reporterName", "reporterEmail", "actorId", "ipAddress", "userAgent"]) {
      assert.equal(Object.hasOwn(JSON.parse(created.body) as object, key), false);
    }
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: report.id, action: "ANONYMOUS_REPORT_SUBMITTED" },
    });
    assert.equal(audit?.actorId, null);
    assert.equal(audit?.ipAddress, null);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal((JSON.parse(duplicate.body) as { id: string }).id, report.id);
    assert.equal(await prisma.anonymousReport.count({ where: { schoolId: school.id } }), 1);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listed.statusCode, 403);
    assert.equal(listed.body.includes(payload.description), false);

    const deniedUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/whistleblower/reports/${report.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "DITINDAKLANJUTI" },
    });
    assert.equal(deniedUpdate.statusCode, 403);
    const deniedSchool = await app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    assert.equal(deniedSchool.statusCode, 403);
    assert.equal((await prisma.anonymousReport.findUniqueOrThrow({ where: { id: report.id } })).status, "BARU");
  });
});
