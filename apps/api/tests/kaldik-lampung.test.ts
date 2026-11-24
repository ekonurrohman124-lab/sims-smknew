import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const OWNED_NPSN = ["90110101", "90110102"];
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

async function wipeOwnedRows(): Promise<void> {
  await assertDatabase(prisma, TARGET_DATABASE);
  const schools = await prisma.school.findMany({ where: { npsn: { in: OWNED_NPSN } }, select: { id: true } });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix08.uji.local" } } });
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(response.statusCode, 200);
  return (JSON.parse(response.body) as { accessToken: string }).accessToken;
}

type Preview = {
  verification: string;
  overlap: boolean;
  year: { id: string; isActive: boolean; startDate: string; endDate: string } | null;
  semesters: Array<{ semesterKind: string; name: string; startDate: string; endDate: string; action: string }>;
};

describe("kaldik lampung", { concurrency: 1 }, () => {
  before(async () => {
    const adminUrl = new URL(isolatedUrl);
    adminUrl.pathname = "/postgres";
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try {
      await assertDatabase(admin, "postgres");
    } finally {
      await admin.$disconnect();
    }
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
  });

  it("mengenali tahun, menolak duplikat dan tabrakan, serta memisahkan sekolah", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Kaldik Uji", npsn: "90110101" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Kaldik Lain", npsn: "90110102" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-14T00:00:00.000Z"), endDate: new Date("2027-07-14T00:00:00.000Z"), isActive: false },
    });
    const student = await prisma.student.create({
      data: { schoolId: school.id, nisn: "9011010101", name: "Siswa Kaldik Uji", gender: "PEREMPUAN" },
    });
    const admin = await prisma.user.create({ data: { email: "admin@fix08.uji.local", name: "Admin Kaldik", passwordHash: await hashPassword(PASSWORD) } });
    const wakakur = await prisma.user.create({ data: { email: "wakakur@fix08.uji.local", name: "Wakakur Kaldik", passwordHash: await hashPassword(PASSWORD) } });
    await grantAssignment(prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await grantAssignment(prisma, { userId: wakakur.id, roleCode: "WAKAKUR", schoolId: school.id });
    const adminHeaders = { authorization: `Bearer ${await tokenFor(admin.email)}` };
    const wakakurHeaders = { authorization: `Bearer ${await tokenFor(wakakur.email)}` };

    const preview = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/kaldik-preview`, headers: wakakurHeaders });
    assert.equal(preview.statusCode, 200);
    const body = (JSON.parse(preview.body) as { preview: Preview }).preview;
    assert.equal(body.verification, "BELUM_TERVERIFIKASI");
    assert.equal(body.overlap, false);
    assert.equal(body.year?.id, year.id);
    assert.deepEqual(body.semesters.map((item) => item.action), ["CREATE", "CREATE"]);

    const odd = body.semesters.find((item) => item.semesterKind === "GANJIL");
    const even = body.semesters.find((item) => item.semesterKind === "GENAP");
    if (!odd || !even) throw new Error("Kandidat semester tidak lengkap.");
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/semesters`,
      headers: wakakurHeaders,
      payload: { academicYearId: year.id, name: odd.name, semesterKind: "GANJIL", startDate: odd.startDate, endDate: odd.endDate, isActive: false },
    });
    assert.equal(denied.statusCode, 403);

    const createdOdd = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/semesters`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: odd.name, semesterKind: odd.semesterKind, startDate: odd.startDate, endDate: odd.endDate, isActive: false },
    });
    assert.equal(createdOdd.statusCode, 201);
    const clash = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/semesters`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: "Semester Tabrakan", semesterKind: "GENAP", startDate: "2026-12-01", endDate: "2027-01-20", isActive: false },
    });
    assert.equal(clash.statusCode, 409);
    const createdEven = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/semesters`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: even.name, semesterKind: even.semesterKind, startDate: even.startDate, endDate: even.endDate, isActive: false },
    });
    assert.equal(createdEven.statusCode, 201);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/semesters`,
      headers: adminHeaders,
      payload: { academicYearId: year.id, name: "Semester Ganjil Lain", semesterKind: "GANJIL", startDate: "2026-08-01", endDate: "2026-08-31", isActive: false },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(await prisma.academicPeriod.count({ where: { schoolId: school.id, academicYearId: year.id } }), 2);
    const storedYear = await prisma.academicYear.findUniqueOrThrow({ where: { id: year.id } });
    assert.equal(storedYear.isActive, false);
    assert.equal(storedYear.startDate.toISOString().slice(0, 10), "2026-07-14");
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).classId, null);
    assert.equal(await prisma.gradeFinalResult.count({ where: { schoolId: school.id } }), 0);

    const again = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/kaldik-preview`, headers: adminHeaders });
    assert.deepEqual((JSON.parse(again.body) as { preview: Preview }).preview.semesters.map((item) => item.action), ["REUSE", "REUSE"]);
    const foreign = await app.inject({ method: "GET", url: `/api/v1/schools/${other.id}/kaldik-preview`, headers: adminHeaders });
    assert.equal(foreign.statusCode, 403);
  });
});
