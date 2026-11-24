import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, beforeEach, describe, it } from "node:test";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  assertCatalogIntegrity,
  cpSlots,
  expertiseConcentrations,
  expertisePrograms,
  resolveSchoolAlias,
  vocationalSubjects,
} from "../src/modules/academic/vocational-master.catalog.ts";
import { applyVocationalMaster } from "../src/modules/academic/vocational-master.service.ts";

const TARGET_DATABASE = "sims_sakti_fix01";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);
const OWNED_NPSN = ["90110081", "90110082"];
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

let prisma: PrismaClient;

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
  const schools = await prisma.school.findMany({ where: { npsn: { in: OWNED_NPSN } }, select: { id: true } });
  const ids = schools.map((school) => school.id);
  if (ids.length === 0) return;
  await prisma.curriculumPlacement.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.curriculum.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.gradeFinalResult.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.schoolClass.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.expertiseConcentration.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.expertiseProgram.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.expertiseField.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.subject.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
  await prisma.school.deleteMany({ where: { id: { in: ids } } });
}

describe("master kejuruan SMK", { concurrency: 1 }, () => {
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
  });

  beforeEach(async () => {
    await wipeOwnedRows();
  });

  after(async () => {
    await wipeOwnedRows();
    await prisma.$disconnect();
  });

  it("menyimpan struktur resmi tanpa rumusan CP karangan", () => {
    assertCatalogIntegrity();
    assert.equal(expertisePrograms.length, 5);
    assert.equal(resolveSchoolAlias("TJKT").concentrationCode, "4.2.1");
    assert.equal(resolveSchoolAlias("TSM").concentrationCode, "2.2.2");
    assert.equal(resolveSchoolAlias("PHT").concentrationCode, "9.2.1");
    assert.equal(resolveSchoolAlias("AKL").concentrationCode, "8.3.3");
    assert.equal(resolveSchoolAlias("BDP").programCode, "8.1");
    assert.equal(resolveSchoolAlias("BDP").concentrationCode, "8.1.2");
    assert.equal(resolveSchoolAlias("PM").concentrationCode, "8.1.2");
    assert.equal(resolveSchoolAlias("BD").status, "COCOK");
    const digital = expertiseConcentrations.find((item) => item.code === "8.1.1");
    assert.equal(digital?.schoolTrack, false);
    assert.equal(digital?.aliases.length, 0);
    const slots = cpSlots();
    assert.ok(slots.length > 0);
    assert.ok(slots.every((slot) => slot.status === "PENDING_VERIFICATION" && slot.statement === null && slot.element === null));
    assert.equal(slots.filter((slot) => slot.decisionNumber === "046/H/KR/2025").length, slots.length);
    const agama = vocationalSubjects.find((item) => item.code === "AGM-PAI");
    const pkl = vocationalSubjects.find((item) => item.code === "PKL");
    assert.equal(agama?.allocations.find((item) => item.gradeLevel === 10)?.intracurricular, 108);
    assert.equal(pkl?.allocations.find((item) => item.gradeLevel === 12)?.intracurricular, 736);
    assert.equal(vocationalSubjects.some((item) => item.code === "DD-PHT"), true);
    assert.equal(vocationalSubjects.some((item) => item.code === "PKK"), false);
  });

  it("idempoten, lintas jurusan, dan tidak mengubah histori", async () => {
    const school = await prisma.school.create({ data: { name: "SMK Master Uji", npsn: "90110081" }, select: { id: true } });
    const other = await prisma.school.create({ data: { name: "SMK Master Lain", npsn: "90110082" }, select: { id: true } });
    const year = await prisma.academicYear.create({
      data: { schoolId: school.id, name: "2026/2027", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z"), isActive: true },
    });
    await prisma.subject.create({ data: { schoolId: school.id, code: "MTK", name: "Matematika Lama", category: "UMUM" } });
    const first = await applyVocationalMaster(prisma, school.id, year.id);
    const tsm = await prisma.expertiseConcentration.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "2.2.2" } } });
    const tjkt = await prisma.expertiseConcentration.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "4.2.1" } } });
    const gradeTenTsm = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, concentrationId: tsm.id, name: "X TSM 1", gradeLevel: 10 },
    });
    const gradeElevenTsm = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, concentrationId: tsm.id, name: "XI TSM 1", gradeLevel: 11 },
    });
    const gradeTwelveTjkt = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, concentrationId: tjkt.id, name: "XII TJKT 1", gradeLevel: 12 },
    });
    const student = await prisma.student.create({
      data: { schoolId: school.id, classId: gradeTenTsm.id, concentrationId: tsm.id, nisn: "9011008101", name: "Siswa Master Uji", gender: "LAKI_LAKI" },
    });
    const beforeGrades = await prisma.gradeFinalResult.count({ where: { schoolId: school.id } });
    const placed = await applyVocationalMaster(prisma, school.id, year.id);
    const repeated = await applyVocationalMaster(prisma, school.id, year.id);

    assert.equal(first.fieldsCreated, 4);
    assert.equal(first.programsCreated, 5);
    assert.equal(first.concentrationsCreated, 5);
    assert.equal(first.conflicts.length, 2);
    assert.equal(repeated.fieldsCreated, 0);
    assert.equal(repeated.programsCreated, 0);
    assert.equal(repeated.concentrationsCreated, 0);
    assert.equal(repeated.subjectsCreated, 0);
    assert.equal(repeated.curriculaCreated, 0);
    assert.equal(repeated.placementsCreated, 0);
    assert.ok(placed.placementsCreated > 0);
    assert.equal(await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "MTK" } } }).then((item) => item.name), "Matematika Lama");
    assert.equal(await prisma.expertiseField.count({ where: { schoolId: other.id } }), 0);
    assert.equal(await prisma.subject.count({ where: { schoolId: other.id } }), 0);

    const mtk = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "MTK" } } });
    const motor = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "KN-222" } } });
    const network = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "KN-421" } } });
    const informatika = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "INF" } } });
    const pkl = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "PKL" } } });
    const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { schoolId_academicYearId_code: { schoolId: school.id, academicYearId: year.id, code: "KM-2026" } } });
    const placedOn = async (classId: string, subjectId: string) => prisma.curriculumPlacement.findUnique({
      where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId, subjectId } },
      select: { id: true },
    });
    assert.ok(await placedOn(gradeTenTsm.id, mtk.id));
    assert.ok(await placedOn(gradeTwelveTjkt.id, mtk.id));
    assert.ok(await placedOn(gradeElevenTsm.id, motor.id));
    assert.equal(await placedOn(gradeTwelveTjkt.id, motor.id), null);
    assert.ok(await placedOn(gradeTwelveTjkt.id, network.id));
    assert.ok(await placedOn(gradeTenTsm.id, informatika.id));
    assert.equal(await placedOn(gradeElevenTsm.id, informatika.id), null);
    assert.equal(await placedOn(gradeElevenTsm.id, pkl.id), null);
    assert.ok(await placedOn(gradeTwelveTjkt.id, pkl.id));
    assert.equal(await prisma.curriculumPlacement.count({
      where: { schoolId: school.id, subject: { code: { in: ["AGM-PAI", "SENI-MUS"] } } },
    }), 0);

    const storedStudent = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(storedStudent.classId, gradeTenTsm.id);
    assert.equal(storedStudent.concentrationId, tsm.id);
    assert.equal(await prisma.gradeFinalResult.count({ where: { schoolId: school.id } }), beforeGrades);
    assert.equal((await prisma.schoolClass.findUniqueOrThrow({ where: { id: gradeTenTsm.id } })).fase, null);
    assert.equal(expertiseConcentrations.filter((item) => item.schoolTrack).length, 5);
    assert.equal(await prisma.expertiseConcentration.findUnique({ where: { schoolId_code: { schoolId: school.id, code: "8.1.1" } } }), null);
    const retail = await prisma.expertiseConcentration.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "8.1.2" } } });
    const gradeTenRetail = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, concentrationId: retail.id, name: "X PM 1", gradeLevel: 10 },
    });
    const gradeElevenRetail = await prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, concentrationId: retail.id, name: "XI BDP 1", gradeLevel: 11 },
    });
    await applyVocationalMaster(prisma, school.id, year.id);
    const dasarPemasaran = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "DD-PM" } } });
    const bisnisRetail = await prisma.subject.findUniqueOrThrow({ where: { schoolId_code: { schoolId: school.id, code: "KN-812" } } });
    assert.equal(await prisma.subject.findUnique({ where: { schoolId_code: { schoolId: school.id, code: "KN-811" } } }), null);
    assert.ok(await prisma.curriculumPlacement.findUnique({
      where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId: gradeTenRetail.id, subjectId: dasarPemasaran.id } },
    }));
    assert.ok(await prisma.curriculumPlacement.findUnique({
      where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId: gradeElevenRetail.id, subjectId: bisnisRetail.id } },
    }));
    assert.equal(await prisma.curriculumPlacement.findUnique({
      where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId: gradeElevenTsm.id, subjectId: bisnisRetail.id } },
    }), null);
  });
});
