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
    where: { npsn: { in: ["90110051", "90110052"] } },
    select: { id: true },
  });
  const ids = schools.map((school) => school.id);
  if (ids.length > 0) {
    await prisma.internshipLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.internshipPlacement.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.studentPayment.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.studentBill.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.counselingReport.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.studentCharacterRecord.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.toolLoan.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.workshopTool.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.bkkJobPost.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.ppdbApplicant.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.anonymousReport.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.homeroomAssignment.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.teacher.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: "@fix05.uji.local" } } });
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

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function assertDenied(response: { statusCode: number; body: string }, status: number, secret: string) {
  assert.equal(response.statusCode, status);
  assert.equal(response.body.includes(secret), false);
  assert.equal(response.body.includes("stack"), false);
  assert.equal(response.body.includes("prisma"), false);
}

describe("RBAC lintas modul", { concurrency: 1 }, () => {
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

  it("menolak panggilan langsung dari peran atau sekolah yang tidak berwenang", async () => {
    const school = await prisma.school.create({ data: { name: "SMK RBAC", npsn: "90110051" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK RBAC Lain", npsn: "90110052" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    const period = await prisma.academicPeriod.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "Ganjil", semesterKind: "GANJIL", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z"), isActive: true },
    });
    const ownClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "XI TKR 1", gradeLevel: 11 } });
    const otherClass = await prisma.schoolClass.create({ data: { schoolId: school.id, academicYearId: year.id, name: "XI TKR 2", gradeLevel: 11 } });
    const secretName = "Siswa Rahasia RBAC";
    const ownStudent = await prisma.student.create({ data: { schoolId: school.id, classId: ownClass.id, nisn: "9011005101", name: secretName, gender: "LAKI_LAKI" } });
    const otherStudent = await prisma.student.create({ data: { schoolId: school.id, classId: otherClass.id, nisn: "9011005102", name: "Siswa Kelas Lain", gender: "PEREMPUAN" } });

    async function user(email: string, name: string, role: "GURU_MAPEL" | "ADMIN_SEKOLAH" | "BENDAHARA" | "WAKA_KESISWAAN" | "KAPROG" | "WALI_KELAS" | "WAKA_HUMAS", schoolId: string) {
      const created = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(PASSWORD) } });
      await grantAssignment(prisma, { userId: created.id, roleCode: role, schoolId });
      return created;
    }

    const guru = await user("guru@fix05.uji.local", "Guru RBAC", "GURU_MAPEL", school.id);
    const admin = await user("admin@fix05.uji.local", "Admin RBAC", "ADMIN_SEKOLAH", school.id);
    const bendahara = await user("bendahara@fix05.uji.local", "Bendahara RBAC", "BENDAHARA", school.id);
    const kesiswaan = await user("kesiswaan@fix05.uji.local", "Waka Kesiswaan", "WAKA_KESISWAAN", school.id);
    const kaprog = await user("kaprog@fix05.uji.local", "Kaprog RBAC", "KAPROG", school.id);
    const humas = await user("humas@fix05.uji.local", "Humas RBAC", "WAKA_HUMAS", school.id);
    const waliUser = await user("wali@fix05.uji.local", "Wali RBAC", "WALI_KELAS", school.id);
    const outsider = await user("luar@fix05.uji.local", "Admin Luar", "ADMIN_SEKOLAH", other.id);
    const waliTeacher = await prisma.teacher.create({ data: { schoolId: school.id, userId: waliUser.id, name: "Wali RBAC", gender: "LAKI_LAKI" } });
    await prisma.homeroomAssignment.create({ data: { schoolId: school.id, teacherId: waliTeacher.id, classId: ownClass.id, academicPeriodId: period.id } });

    const guruToken = await tokenFor(guru.email);
    const adminToken = await tokenFor(admin.email);
    const financeToken = await tokenFor(bendahara.email);
    const counselingToken = await tokenFor(kesiswaan.email);
    const kaprogToken = await tokenFor(kaprog.email);
    const humasToken = await tokenFor(humas.email);
    const waliToken = await tokenFor(waliUser.email);
    const outsiderToken = await tokenFor(outsider.email);

    const open = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/character-records` });
    assertDenied(open, 401, secretName);

    const guruCharacter = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/character-records`, headers: auth(guruToken) });
    assertDenied(guruCharacter, 403, secretName);
    const guruCharacterWrite = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/character-records`,
      headers: auth(guruToken),
      payload: { studentId: ownStudent.id, recordType: "PELANGGARAN", category: "Kehadiran", points: 5, note: "Catatan rahasia" },
    });
    assertDenied(guruCharacterWrite, 403, secretName);
    const counselingRead = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/character-records`, headers: auth(counselingToken) });
    assert.equal(counselingRead.statusCode, 200, counselingRead.body);
    const outsiderCharacter = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/character-records`, headers: auth(outsiderToken) });
    assertDenied(outsiderCharacter, 403, secretName);

    const filed = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/counseling-reports`,
      headers: auth(guruToken),
      payload: { isAnonymous: true, subject: "Konseling rahasia", description: "Uraian yang tidak boleh tersebar" },
    });
    assert.equal(filed.statusCode, 200, filed.body);
    const reportId = (JSON.parse(filed.body) as { report: { id: string } }).report.id;
    const guruQueue = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/counseling-reports`, headers: auth(guruToken) });
    assert.equal(guruQueue.statusCode, 200, guruQueue.body);
    const ownQueue = JSON.parse(guruQueue.body) as { canManageAll: boolean; reports: Array<{ id: string; reporterUserId: string | null }> };
    assert.equal(ownQueue.canManageAll, false);
    assert.equal(ownQueue.reports.length, 1);
    assert.equal(ownQueue.reports[0]?.reporterUserId, null);
    const staffQueue = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/counseling-reports`, headers: auth(counselingToken) });
    const staffBody = JSON.parse(staffQueue.body) as { reports: Array<{ id: string; reporterUserId: string | null }> };
    assert.equal(staffBody.reports.find((item) => item.id === reportId)?.reporterUserId, null);
    const guruDecision = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/counseling-reports/${reportId}`,
      headers: auth(guruToken),
      payload: { status: "SELESAI" },
    });
    assertDenied(guruDecision, 403, "Uraian yang tidak boleh tersebar");

    const guruBill = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/bills`,
      headers: auth(guruToken),
      payload: { studentId: ownStudent.id, title: "SPP", amount: 150000 },
    });
    assertDenied(guruBill, 403, secretName);
    const guruBillList = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/bills`, headers: auth(guruToken) });
    assertDenied(guruBillList, 403, secretName);
    const bill = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/bills`,
      headers: auth(financeToken),
      payload: { studentId: ownStudent.id, title: "SPP", amount: 150000 },
    });
    assert.equal(bill.statusCode, 200, bill.body);
    const billId = (JSON.parse(bill.body) as { bill: { id: string } }).bill.id;
    const guruPay = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/bills/${billId}/payments`,
      headers: auth(guruToken),
      payload: { amount: 150000, channel: "TUNAI" },
    });
    assertDenied(guruPay, 403, secretName);
    const webhook = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payment-gateway",
      payload: { schoolId: school.id, billId, amount: 150000, channel: "MIDTRANS", orderId: "ord-rbac-05", transactionStatus: "PAID" },
    });
    assertDenied(webhook, 401, secretName);
    assert.equal((await prisma.studentBill.findUniqueOrThrow({ where: { id: billId } })).paidAmount, 0);

    const guruPlacement = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/internship-placements`,
      headers: auth(guruToken),
      payload: { studentId: ownStudent.id, companyName: "Bengkel Utara", startDate: "2026-07-01", endDate: "2026-09-01" },
    });
    assertDenied(guruPlacement, 403, secretName);
    const guruPklList = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/internship-placements`, headers: auth(guruToken) });
    assertDenied(guruPklList, 403, secretName);
    const placement = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/internship-placements`,
      headers: auth(adminToken),
      payload: { studentId: ownStudent.id, companyName: "Bengkel Utara", startDate: "2026-07-01", endDate: "2026-09-01" },
    });
    assert.equal(placement.statusCode, 200, placement.body);
    await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/internship-placements`,
      headers: auth(adminToken),
      payload: { studentId: otherStudent.id, companyName: "Bengkel Selatan", startDate: "2026-07-01", endDate: "2026-09-01" },
    });
    const waliList = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/internship-placements`, headers: auth(waliToken) });
    assert.equal(waliList.statusCode, 200, waliList.body);
    const waliPlacements = JSON.parse(waliList.body) as { placements: Array<{ student: { id: string } }> };
    assert.deepEqual(waliPlacements.placements.map((item) => item.student.id), [ownStudent.id]);

    const guruTool = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/vokasi/tools`,
      headers: auth(guruToken),
      payload: { assetCode: "RBAC-01", name: "Kunci Torsi", labName: "TKR" },
    });
    assertDenied(guruTool, 403, "Kunci Torsi");
    const tool = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/vokasi/tools`,
      headers: auth(kaprogToken),
      payload: { assetCode: "RBAC-01", name: "Kunci Torsi", labName: "TKR" },
    });
    assert.equal(tool.statusCode, 200, tool.body);
    const guruTools = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/vokasi/tools`, headers: auth(guruToken) });
    assert.equal(guruTools.statusCode, 200, guruTools.body);
    const guruJob = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/vokasi/bkk-jobs`,
      headers: auth(guruToken),
      payload: { companyName: "Industri", positionTitle: "Mekanik", location: "Lampung", description: "Lowongan rahasia industri" },
    });
    assertDenied(guruJob, 403, "Lowongan rahasia industri");
    const job = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/vokasi/bkk-jobs`,
      headers: auth(humasToken),
      payload: { companyName: "Industri", positionTitle: "Mekanik", location: "Lampung", description: "Lowongan mekanik" },
    });
    assert.equal(job.statusCode, 200, job.body);

    const guruPpdb = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/ppdb/applicants`, headers: auth(guruToken) });
    assertDenied(guruPpdb, 403, secretName);
    const ppdb = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/ppdb/applicants`,
      headers: auth(humasToken),
      payload: { fullName: "Calon RBAC", originSchool: "SMP Contoh", chosenMajor: "TKR", parentPhone: "081234567890" },
    });
    assert.equal(ppdb.statusCode, 200, ppdb.body);
    const applicantId = (JSON.parse(ppdb.body) as { id: string }).id;
    const guruPpdbPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/ppdb/applicants/${applicantId}`,
      headers: auth(guruToken),
      payload: { status: "DITERIMA" },
    });
    assertDenied(guruPpdbPatch, 403, "081234567890");

    const report = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/whistleblower/reports`,
      headers: auth(guruToken),
      payload: { category: "PERUNDUNGAN_BULLYING", description: "Aduan rahasia yang tidak boleh dibaca pengajar lain." },
    });
    assert.equal(report.statusCode, 200, report.body);
    const aduanId = (JSON.parse(report.body) as { id: string }).id;
    const guruAduan = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/whistleblower/reports`, headers: auth(guruToken) });
    assertDenied(guruAduan, 403, "Aduan rahasia");
    const staffAduan = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/whistleblower/reports`, headers: auth(counselingToken) });
    assert.equal(staffAduan.statusCode, 200, staffAduan.body);
    assert.equal(staffAduan.body.includes("reporterEmail"), false);
    const outsiderAduan = await app.inject({ method: "GET", url: `/api/v1/schools/${school.id}/whistleblower/reports`, headers: auth(outsiderToken) });
    assertDenied(outsiderAduan, 403, "Aduan rahasia");
    const guruClose = await app.inject({
      method: "PATCH",
      url: `/api/v1/schools/${school.id}/whistleblower/reports/${aduanId}`,
      headers: auth(guruToken),
      payload: { status: "SELESAI" },
    });
    assertDenied(guruClose, 403, "Aduan rahasia");
    assert.equal((await prisma.anonymousReport.findUniqueOrThrow({ where: { id: aduanId } })).status, "BARU");
  });
});
