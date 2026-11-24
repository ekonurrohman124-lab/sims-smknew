import { Prisma, PrismaClient } from "@prisma/client";
import {
  assertCatalogIntegrity,
  curriculumBlueprint,
  expertiseConcentrations,
  expertiseFields,
  expertisePrograms,
  schoolConfirmations,
  STRUCTURE_SOURCE,
  vocationalSubjects,
} from "./vocational-master.catalog.ts";

const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);

export type VocationalMasterResult = {
  fieldsCreated: number;
  programsCreated: number;
  concentrationsCreated: number;
  subjectsCreated: number;
  curriculaCreated: number;
  placementsCreated: number;
  unchanged: number;
  conflicts: string[];
  confirmations: string[];
};

type Db = PrismaClient | Prisma.TransactionClient;

async function assertAllowedDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const name = rows[0]?.name ?? "";
  if (BANNED_DATABASES.has(name)) {
    throw new Error("Master kejuruan tidak dijalankan pada database aktif.");
  }
}

const SUBJECT_MASTER_DATABASE = "sims_sakti_qc";
const KIK_NAME = "Kreativitas, Inovasi, dan Kewirausahaan";

export function assertSubjectCatalogReady(): void {
  assertCatalogIntegrity();
  const codes = vocationalSubjects.map((item) => item.code);
  const names = vocationalSubjects.map((item) => item.name);
  if (vocationalSubjects.length !== 30 || new Set(codes).size !== codes.length || new Set(names).size !== names.length) {
    throw new Error("Katalog mata pelajaran tidak berjumlah 30 atau memiliki kode maupun nama ganda.");
  }
  const kik = vocationalSubjects.find((item) => item.code === "KIK");
  if (!kik || kik.name !== KIK_NAME || kik.group !== "KEJURUAN" || kik.nameSource !== STRUCTURE_SOURCE) {
    throw new Error("Nama KIK tidak sesuai referensi katalog Permendikdasmen Nomor 13 Tahun 2025.");
  }
  if (vocationalSubjects.some((item) => item.code === "PKK" || item.name.length < 2 || item.name.length > 120 || item.code.length > 16)) {
    throw new Error("Katalog mata pelajaran memiliki kode atau nama yang tidak dapat disimpan.");
  }
}

export async function applySubjectMaster(prisma: PrismaClient, schoolId: string): Promise<VocationalMasterResult> {
  assertSubjectCatalogReady();
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (rows[0]?.name !== SUBJECT_MASTER_DATABASE) {
    throw new Error("Master mata pelajaran hanya dijalankan pada database sims_sakti_qc.");
  }
  const existing = await prisma.subject.findMany({
    where: { schoolId },
    select: { code: true, name: true, category: true },
  });
  const byCode = new Map(existing.map((item) => [item.code, item]));
  const byName = new Map(existing.map((item) => [item.name, item]));
  for (const item of vocationalSubjects) {
    const stored = byCode.get(item.code);
    if (stored && (stored.name !== item.name || stored.category !== item.group)) {
      throw new Error(`Kode ${item.code} sudah tersimpan dengan identitas berbeda. Tidak ada data yang diubah.`);
    }
    const sameName = byName.get(item.name);
    if (sameName && sameName.code !== item.code) {
      throw new Error(`Nama ${item.name} sudah dipakai kode lain. Tidak ada data yang diubah.`);
    }
  }
  for (const item of existing) {
    if (!vocationalSubjects.some((subject) => subject.code === item.code)) {
      throw new Error("Master mata pelajaran berisi kode di luar katalog. Tidak ada data yang diubah.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const result: VocationalMasterResult = {
      fieldsCreated: 0,
      programsCreated: 0,
      concentrationsCreated: 0,
      subjectsCreated: 0,
      curriculaCreated: 0,
      placementsCreated: 0,
      unchanged: 0,
      conflicts: [],
      confirmations: [],
    };
    for (const item of vocationalSubjects) {
      await ensureSubject(tx, schoolId, item.code, item.name, item.group, result);
    }
    if (result.conflicts.length > 0 || result.curriculaCreated !== 0 || result.placementsCreated !== 0) {
      throw new Error("Pemasukan mata pelajaran berhenti karena ada konflik atau perubahan di luar master mapel.");
    }
    return result;
  });
}

async function reuseNamed<T extends { id: string; name: string; code: string }>(
  found: T | null,
  expectedName: string,
  create: () => Promise<T>,
  result: VocationalMasterResult,
): Promise<T> {
  if (!found) {
    return create();
  }
  if (found.name !== expectedName) {
    result.conflicts.push(`${found.code}: nama tersimpan dipertahankan.`);
  }
  result.unchanged += 1;
  return found;
}

async function ensureField(db: Db, schoolId: string, code: string, name: string, result: VocationalMasterResult) {
  const found = await db.expertiseField.findUnique({ where: { schoolId_code: { schoolId, code } } });
  return reuseNamed(found, name, async () => {
    result.fieldsCreated += 1;
    return db.expertiseField.create({ data: { schoolId, code, name } });
  }, result);
}

async function ensureProgram(db: Db, schoolId: string, fieldId: string, code: string, name: string, result: VocationalMasterResult) {
  const found = await db.expertiseProgram.findUnique({ where: { schoolId_code: { schoolId, code } } });
  return reuseNamed(found, name, async () => {
    result.programsCreated += 1;
    return db.expertiseProgram.create({ data: { schoolId, fieldId, code, name } });
  }, result);
}

async function ensureConcentration(db: Db, schoolId: string, programId: string, code: string, name: string, result: VocationalMasterResult) {
  const found = await db.expertiseConcentration.findUnique({ where: { schoolId_code: { schoolId, code } } });
  return reuseNamed(found, name, async () => {
    result.concentrationsCreated += 1;
    return db.expertiseConcentration.create({ data: { schoolId, programId, code, name } });
  }, result);
}

async function ensureSubject(
  db: Db,
  schoolId: string,
  code: string,
  name: string,
  category: "UMUM" | "KEJURUAN",
  result: VocationalMasterResult,
) {
  const found = await db.subject.findUnique({ where: { schoolId_code: { schoolId, code } } });
  if (found && found.category !== category) result.conflicts.push(`${code}: kategori tersimpan dipertahankan.`);
  return reuseNamed(found, name, async () => {
    result.subjectsCreated += 1;
    return db.subject.create({ data: { schoolId, code, name, category } });
  }, result);
}

export async function applyVocationalMaster(
  prisma: PrismaClient,
  schoolId: string,
  academicYearId: string,
): Promise<VocationalMasterResult> {
  assertCatalogIntegrity();
  await assertAllowedDatabase(prisma);
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId }, select: { id: true } });
  if (!year) throw new Error("Tahun pelajaran tidak ditemukan di sekolah ini.");

  return prisma.$transaction(async (tx) => {
    const result: VocationalMasterResult = {
      fieldsCreated: 0,
      programsCreated: 0,
      concentrationsCreated: 0,
      subjectsCreated: 0,
      curriculaCreated: 0,
      placementsCreated: 0,
      unchanged: 0,
      conflicts: [],
      confirmations: schoolConfirmations.map((item) => item.message),
    };
    const fieldIds = new Map<string, string>();
    for (const field of expertiseFields) {
      const row = await ensureField(tx, schoolId, field.code, field.name, result);
      fieldIds.set(field.code, row.id);
    }
    const programIds = new Map<string, string>();
    for (const program of expertisePrograms) {
      const fieldId = fieldIds.get(program.fieldCode);
      if (!fieldId) throw new Error("Bidang keahlian katalog tidak tersedia.");
      const row = await ensureProgram(tx, schoolId, fieldId, program.code, program.name, result);
      programIds.set(program.code, row.id);
    }
    const concentrationIds = new Map<string, string>();
    const activeConcentrations = expertiseConcentrations.filter((item) => item.schoolTrack);
    for (const concentration of activeConcentrations) {
      const programId = programIds.get(concentration.programCode);
      if (!programId) throw new Error("Program keahlian katalog tidak tersedia.");
      const row = await ensureConcentration(tx, schoolId, programId, concentration.code, concentration.name, result);
      concentrationIds.set(concentration.code, row.id);
    }
    const subjectIds = new Map<string, string>();
    for (const item of vocationalSubjects) {
      const row = await ensureSubject(tx, schoolId, item.code, item.name, item.group, result);
      subjectIds.set(item.code, row.id);
    }

    const existingCurriculum = await tx.curriculum.findUnique({
      where: { schoolId_academicYearId_code: { schoolId, academicYearId, code: curriculumBlueprint.code } },
    });
    const curriculum = await reuseNamed(existingCurriculum, curriculumBlueprint.name, async () => {
      result.curriculaCreated += 1;
      return tx.curriculum.create({
        data: {
          schoolId,
          academicYearId,
          code: curriculumBlueprint.code,
          name: curriculumBlueprint.name,
          description: curriculumBlueprint.description,
        },
      });
    }, result);

    const classes = await tx.schoolClass.findMany({
      where: { schoolId, academicYearId, concentrationId: { in: [...concentrationIds.values()] } },
      select: { id: true, gradeLevel: true, concentrationId: true },
    });
    const concentrationCodeById = new Map([...concentrationIds.entries()].map(([code, id]) => [id, code]));
    for (const schoolClass of classes) {
      const concentrationCode = schoolClass.concentrationId ? concentrationCodeById.get(schoolClass.concentrationId) : null;
      const concentration = expertiseConcentrations.find((item) => item.code === concentrationCode);
      if (!concentration || (schoolClass.gradeLevel !== 10 && schoolClass.gradeLevel !== 11 && schoolClass.gradeLevel !== 12)) continue;
      for (const item of vocationalSubjects) {
        if (item.placement !== "OTOMATIS" || !item.grades.includes(schoolClass.gradeLevel as 10 | 11 | 12)) continue;
        if (item.scope === "PROGRAM" && item.programCode !== concentration.programCode) continue;
        if (item.scope === "KONSENTRASI" && item.concentrationCode !== concentration.code) continue;
        const subjectId = subjectIds.get(item.code);
        if (!subjectId) continue;
        const existing = await tx.curriculumPlacement.findUnique({
          where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId: schoolClass.id, subjectId } },
          select: { id: true },
        });
        if (existing) {
          result.unchanged += 1;
          continue;
        }
        await tx.curriculumPlacement.create({
          data: { schoolId, curriculumId: curriculum.id, classId: schoolClass.id, subjectId },
        });
        result.placementsCreated += 1;
      }
    }
    return result;
  });
}

export type CurriculumFoundationResult = {
  curriculaCreated: number;
  placementsCreated: number;
  placementsUnchanged: number;
  fasesSet: number;
  fasesUnchanged: number;
};

function expectedFase(gradeLevel: number): "E" | "F" | null {
  if (gradeLevel === 10) return "E";
  if (gradeLevel === 11 || gradeLevel === 12) return "F";
  return null;
}

export async function applyCurriculumFoundation(
  prisma: PrismaClient,
  schoolId: string,
  academicYearId: string,
): Promise<CurriculumFoundationResult> {
  assertSubjectCatalogReady();
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (database[0]?.name !== SUBJECT_MASTER_DATABASE) {
    throw new Error("Kurikulum hanya dijalankan pada database sims_sakti_qc.");
  }
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId, name: "2026/2027", isActive: true },
    select: { id: true },
  });
  if (!year) throw new Error("Tahun pelajaran 2026/2027 tidak aktif. Tidak ada data yang diubah.");

  const subjects = await prisma.subject.findMany({
    where: { schoolId },
    select: { id: true, code: true, name: true, category: true },
  });
  if (subjects.length !== vocationalSubjects.length) {
    throw new Error("Jumlah mata pelajaran tidak sesuai katalog. Tidak ada data yang diubah.");
  }
  const subjectIds = new Map<string, string>();
  for (const item of vocationalSubjects) {
    const stored = subjects.find((subject) => subject.code === item.code);
    if (!stored || stored.name !== item.name || stored.category !== item.group) {
      throw new Error(`Mapel ${item.code} tidak sesuai katalog. Tidak ada data yang diubah.`);
    }
    subjectIds.set(item.code, stored.id);
  }

  const concentrations = await prisma.expertiseConcentration.findMany({
    where: { schoolId, isActive: true },
    select: { id: true, code: true, program: { select: { code: true } } },
  });
  const opened = expertiseConcentrations.filter((item) => item.schoolTrack);
  if (concentrations.length !== opened.length) {
    throw new Error("Konsentrasi sekolah tidak sesuai. Tidak ada data yang diubah.");
  }
  const concentrationById = new Map<string, { code: string; programCode: string }>();
  for (const item of opened) {
    const stored = concentrations.find((row) => row.code === item.code && row.program.code === item.programCode);
    if (!stored) throw new Error(`Konsentrasi ${item.code} tidak sesuai katalog. Tidak ada data yang diubah.`);
    concentrationById.set(stored.id, { code: item.code, programCode: item.programCode });
  }

  const classes = await prisma.schoolClass.findMany({
    where: { schoolId, academicYearId, isActive: true },
    select: { id: true, name: true, gradeLevel: true, concentrationId: true, fase: true },
  });
  if (classes.length !== 30) throw new Error("Jumlah kelas aktif tidak 30. Tidak ada data yang diubah.");
  const gradeCounts = { 10: 0, 11: 0, 12: 0 };
  for (const schoolClass of classes) {
    const fase = expectedFase(schoolClass.gradeLevel);
    const concentration = schoolClass.concentrationId ? concentrationById.get(schoolClass.concentrationId) : null;
    if (!fase || !concentration) throw new Error(`Kelas ${schoolClass.name} tidak siap dipetakan. Tidak ada data yang diubah.`);
    if (schoolClass.fase !== null && schoolClass.fase !== fase) {
      throw new Error(`Fase kelas ${schoolClass.name} berbeda dari katalog. Tidak ada data yang diubah.`);
    }
    gradeCounts[schoolClass.gradeLevel as 10 | 11 | 12] += 1;
  }
  if (gradeCounts[10] !== 13 || gradeCounts[11] !== 9 || gradeCounts[12] !== 8) {
    throw new Error("Sebaran kelas X, XI, dan XII tidak sesuai. Tidak ada data yang diubah.");
  }

  const existingCurriculum = await prisma.curriculum.findUnique({
    where: { schoolId_academicYearId_code: { schoolId, academicYearId, code: curriculumBlueprint.code } },
    select: { id: true, name: true },
  });
  if (existingCurriculum && existingCurriculum.name !== curriculumBlueprint.name) {
    throw new Error("Kurikulum KM-2026 sudah ada dengan nama berbeda. Tidak ada data yang diubah.");
  }

  return prisma.$transaction(async (tx) => {
    const result: CurriculumFoundationResult = {
      curriculaCreated: 0,
      placementsCreated: 0,
      placementsUnchanged: 0,
      fasesSet: 0,
      fasesUnchanged: 0,
    };
    const curriculum = existingCurriculum ?? await tx.curriculum.create({
      data: {
        schoolId,
        academicYearId,
        code: curriculumBlueprint.code,
        name: curriculumBlueprint.name,
        description: curriculumBlueprint.description,
        isActive: true,
      },
      select: { id: true, name: true },
    });
    if (!existingCurriculum) result.curriculaCreated = 1;

    for (const schoolClass of classes) {
      const fase = expectedFase(schoolClass.gradeLevel);
      if (!fase) throw new Error("Tingkat kelas tidak dikenal.");
      if (schoolClass.fase === fase) {
        result.fasesUnchanged += 1;
      } else {
        await tx.schoolClass.update({ where: { id: schoolClass.id }, data: { fase } });
        result.fasesSet += 1;
      }
      const concentration = concentrationById.get(schoolClass.concentrationId ?? "");
      if (!concentration) throw new Error("Konsentrasi kelas hilang saat penempatan.");
      for (const item of vocationalSubjects) {
        if (item.placement !== "OTOMATIS" || !item.grades.includes(schoolClass.gradeLevel as 10 | 11 | 12)) continue;
        if (item.scope === "PROGRAM" && item.programCode !== concentration.programCode) continue;
        if (item.scope === "KONSENTRASI" && item.concentrationCode !== concentration.code) continue;
        const subjectId = subjectIds.get(item.code);
        if (!subjectId) throw new Error(`Mapel ${item.code} tidak tersedia.`);
        const existing = await tx.curriculumPlacement.findUnique({
          where: { curriculumId_classId_subjectId: { curriculumId: curriculum.id, classId: schoolClass.id, subjectId } },
          select: { id: true },
        });
        if (existing) {
          result.placementsUnchanged += 1;
          continue;
        }
        await tx.curriculumPlacement.create({
          data: { schoolId, curriculumId: curriculum.id, classId: schoolClass.id, subjectId },
        });
        result.placementsCreated += 1;
      }
    }

    const stored = await tx.curriculumPlacement.findMany({
      where: { curriculumId: curriculum.id },
      select: {
        subject: { select: { code: true } },
        class: { select: { gradeLevel: true, concentration: { select: { code: true, program: { select: { code: true } } } } } },
      },
    });
    if (stored.length !== 245) throw new Error("Jumlah penempatan bukan 245. Perubahan dibatalkan.");
    for (const row of stored) {
      const catalog = vocationalSubjects.find((item) => item.code === row.subject.code);
      const concentration = row.class.concentration;
      if (!catalog || catalog.placement !== "OTOMATIS" || !concentration) {
        throw new Error("Penempatan berisi mapel yang tidak otomatis. Perubahan dibatalkan.");
      }
      if (!catalog.grades.includes(row.class.gradeLevel as 10 | 11 | 12)) {
        throw new Error("Penempatan berada pada tingkat yang salah. Perubahan dibatalkan.");
      }
      if (catalog.scope === "PROGRAM" && catalog.programCode !== concentration.program.code) {
        throw new Error("Mapel program masuk ke jurusan lain. Perubahan dibatalkan.");
      }
      if (catalog.scope === "KONSENTRASI" && catalog.concentrationCode !== concentration.code) {
        throw new Error("Mapel konsentrasi masuk ke konsentrasi lain. Perubahan dibatalkan.");
      }
    }
    const gradeTen = stored.filter((row) => row.class.gradeLevel === 10).length;
    const gradeEleven = stored.filter((row) => row.class.gradeLevel === 11).length;
    const gradeTwelve = stored.filter((row) => row.class.gradeLevel === 12).length;
    if (gradeTen !== 117 || gradeEleven !== 72 || gradeTwelve !== 56) {
      throw new Error("Sebaran penempatan X, XI, dan XII tidak sesuai. Perubahan dibatalkan.");
    }
    return result;
  }, { maxWait: 10_000, timeout: 120_000 });
}
