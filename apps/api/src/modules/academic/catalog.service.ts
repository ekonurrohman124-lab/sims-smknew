import type {
  AcademicYearDto,
  ExpertiseConcentrationDto,
  ExpertiseFieldDto,
  ExpertiseProgramDto,
  PageResult,
  SchoolClassDto,
  SubjectDto,
} from "@sims/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import {
  auditChange,
  duplicate,
  emptyPage,
  inUse,
  invalidReference,
  ownedRow,
  pageWindow,
  parseDateOnly,
  rethrowKnown,
  toDateOnly,
  type PageQuery,
} from "./common.ts";
import type { DataScope } from "./scope.ts";
import type { RequestMeta } from "../../lib/tenant.ts";
import { rangesOverlap } from "./kaldik-lampung.ts";

type YearInput = { name: string; startDate: string; endDate: string; isActive: boolean };
type SemesterInput = YearInput & { academicYearId: string; semesterKind: "GANJIL" | "GENAP"; confirmUsedChange?: boolean };
type NamedInput = { code: string; name: string; isActive: boolean };
type ClassInput = {
  academicYearId: string;
  concentrationId: string | null;
  name: string;
  gradeLevel: number;
  capacity: number;
  isActive: boolean;
};
type SubjectInput = { code: string; name: string; category: "UMUM" | "KEJURUAN"; isActive: boolean };

function searchName(q: string | undefined): Prisma.StringFilter | undefined {
  return q ? { contains: q, mode: "insensitive" } : undefined;
}

async function clearActiveYear(tx: Prisma.TransactionClient, schoolId: string, exceptId?: string) {
  await tx.academicYear.updateMany({
    where: { schoolId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isActive: false },
  });
}

async function assertSemesterWindow(
  prisma: PrismaClient,
  schoolId: string,
  input: SemesterInput,
  exceptId?: string,
) {
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { academicYearId: true, semesterKind: true, startDate: true, endDate: true },
  });
  if (periods.some((period) => period.academicYearId === input.academicYearId && period.semesterKind === input.semesterKind)) {
    inUse("Semester dengan jenis yang sama sudah ada pada tahun pelajaran ini.");
  }
  const start = input.startDate;
  const end = input.endDate;
  if (periods.some((period) => rangesOverlap(start, end, toDateOnly(period.startDate), toDateOnly(period.endDate)))) {
    inUse("Periode semester bertabrakan dengan semester lain.");
  }
}

async function semesterUsageLocks(prisma: PrismaClient, id: string): Promise<string[]> {
  const [teachings, homerooms, finals, submissions, reports, notes, meetings, daily] = await Promise.all([
    prisma.teachingAssignment.count({ where: { academicPeriodId: id } }),
    prisma.homeroomAssignment.count({ where: { academicPeriodId: id } }),
    prisma.gradeFinalResult.count({ where: { teachingAssignment: { academicPeriodId: id } } }),
    prisma.gradeSubmission.count({ where: { teachingAssignment: { academicPeriodId: id } } }),
    prisma.reportCardWorkflow.count({ where: { academicPeriodId: id } }),
    prisma.homeroomNote.count({ where: { academicPeriodId: id } }),
    prisma.attendanceMeeting.count({ where: { teachingAssignment: { academicPeriodId: id } } }),
    prisma.dailyAttendance.count({ where: { homeroom: { academicPeriodId: id } } }),
  ]);
  const reasons: string[] = [];
  if (teachings + homerooms > 0) reasons.push("penugasan");
  if (finals + submissions > 0) reasons.push("nilai");
  if (reports + notes > 0) reasons.push("rapor");
  if (meetings + daily > 0) reasons.push("presensi");
  return reasons;
}

async function clearActivePeriod(tx: Prisma.TransactionClient, schoolId: string, exceptId?: string) {
  await tx.academicPeriod.updateMany({
    where: { schoolId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isActive: false },
  });
}

export async function listYears(prisma: PrismaClient, schoolId: string, query: PageQuery): Promise<PageResult<AcademicYearDto>> {
  const where: Prisma.AcademicYearWhereInput = { schoolId, ...(query.q ? { name: searchName(query.q) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.academicYear.findMany({ where, orderBy: { startDate: "desc" }, ...pageWindow(query) }),
    prisma.academicYear.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId: row.schoolId,
      name: row.name,
      startDate: toDateOnly(row.startDate),
      endDate: toDateOnly(row.endDate),
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createYear(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: YearInput,
  meta: RequestMeta,
) {
  try {
    const year = await prisma.$transaction(async (tx) => {
      if (input.isActive) await clearActiveYear(tx, schoolId);
      return tx.academicYear.create({
        data: {
          schoolId,
          name: input.name,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          isActive: input.isActive,
        },
      });
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "YEAR_CREATED", entityType: "AcademicYear", entityId: year.id });
    return {
      id: year.id,
      schoolId,
      name: year.name,
      startDate: toDateOnly(year.startDate),
      endDate: toDateOnly(year.endDate),
      isActive: year.isActive,
    };
  } catch (error) {
    rethrowKnown(error, "Tahun pelajaran sudah ada di sekolah ini.");
  }
}

async function yearIdentityLocks(prisma: PrismaClient, id: string): Promise<string[]> {
  const [classes, curricula, finalGrades, submissions, reports, notes] = await Promise.all([
    prisma.schoolClass.count({ where: { academicYearId: id } }),
    prisma.curriculum.count({ where: { academicYearId: id } }),
    prisma.gradeFinalResult.count({ where: { teachingAssignment: { academicPeriod: { academicYearId: id } } } }),
    prisma.gradeSubmission.count({ where: { teachingAssignment: { academicPeriod: { academicYearId: id } } } }),
    prisma.reportCardWorkflow.count({ where: { academicYearId: id } }),
    prisma.homeroomNote.count({ where: { academicYearId: id } }),
  ]);
  const reasons: string[] = [];
  if (classes > 0) reasons.push("kelas");
  if (curricula > 0) reasons.push("kurikulum");
  if (finalGrades + submissions > 0) reasons.push("nilai");
  if (reports + notes > 0) reasons.push("rapor");
  return reasons;
}

export async function updateYear(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: YearInput,
  meta: RequestMeta,
) {
  const current = await ownedRow(
    prisma.academicYear.findFirst({ where: { id, schoolId }, select: { id: true, name: true, startDate: true, endDate: true } }),
    "Tahun pelajaran tidak ditemukan.",
  );
  const identityChanged =
    current.name !== input.name || toDateOnly(current.startDate) !== input.startDate || toDateOnly(current.endDate) !== input.endDate;
  if (identityChanged) {
    const reasons = await yearIdentityLocks(prisma, id);
    if (reasons.length > 0) {
      inUse(`Nama dan tanggal tidak diubah karena tahun pelajaran sudah dipakai oleh ${reasons.join(", ")}. Status aktif tetap dapat diperbarui. Data kelas, nilai, dan rapor tidak dihapus.`);
    }
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (input.isActive) await clearActiveYear(tx, schoolId, id);
      await tx.academicYear.update({
        where: { id },
        data: {
          name: input.name,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          isActive: input.isActive,
        },
      });
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "YEAR_UPDATED", entityType: "AcademicYear", entityId: id });
    const year = await prisma.academicYear.findFirstOrThrow({ where: { id, schoolId } });
    return {
      id: year.id,
      schoolId,
      name: year.name,
      startDate: toDateOnly(year.startDate),
      endDate: toDateOnly(year.endDate),
      isActive: year.isActive,
    };
  } catch (error) {
    rethrowKnown(error, "Tahun pelajaran sudah ada di sekolah ini.");
  }
}

export async function deleteYear(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.academicYear.findFirst({ where: { id, schoolId }, select: { id: true } }), "Tahun pelajaran tidak ditemukan.");
  const [periods, classes, curricula] = await Promise.all([
    prisma.academicPeriod.count({ where: { academicYearId: id } }),
    prisma.schoolClass.count({ where: { academicYearId: id } }),
    prisma.curriculum.count({ where: { academicYearId: id } }),
  ]);
  if (periods + classes + curricula > 0) inUse("Tahun pelajaran masih digunakan oleh semester, kelas, atau kurikulum.");
  await prisma.academicYear.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "YEAR_DELETED", entityType: "AcademicYear", entityId: id });
}

export async function listSemesters(prisma: PrismaClient, schoolId: string, query: PageQuery) {
  const where: Prisma.AcademicPeriodWhereInput = {
    schoolId,
    ...(query.q ? { name: searchName(query.q) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.academicPeriod.findMany({
      where,
      include: { academicYear: { select: { name: true } } },
      orderBy: { startDate: "desc" },
      ...pageWindow(query),
    }),
    prisma.academicPeriod.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId: row.schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear?.name ?? null,
      name: row.name,
      semesterKind: row.semesterKind,
      startDate: toDateOnly(row.startDate),
      endDate: toDateOnly(row.endDate),
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createSemester(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: SemesterInput,
  meta: RequestMeta,
) {
  await ownedRow(
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }),
    "Tahun pelajaran tidak ditemukan di sekolah ini.",
  );
  await assertSemesterWindow(prisma, schoolId, input);
  try {
    const period = await prisma.$transaction(async (tx) => {
      if (input.isActive) await clearActivePeriod(tx, schoolId);
      return tx.academicPeriod.create({
        data: {
          schoolId,
          academicYearId: input.academicYearId,
          name: input.name,
          semesterKind: input.semesterKind,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          isActive: input.isActive,
        },
      });
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "SEMESTER_CREATED", entityType: "AcademicPeriod", entityId: period.id });
    const page = await listSemesters(prisma, schoolId, { page: 1, pageSize: 50, q: period.name });
    const created = page.items.find((item) => item.id === period.id);
    if (!created) throw new Error("Semester gagal dimuat ulang.");
    return created;
  } catch (error) {
    rethrowKnown(error, "Nama semester sudah digunakan di sekolah ini.");
  }
}

export async function updateSemester(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: SemesterInput,
  meta: RequestMeta,
) {
  const current = await ownedRow(
    prisma.academicPeriod.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, academicYearId: true, semesterKind: true, startDate: true, endDate: true, isActive: true },
    }),
    "Semester tidak ditemukan.",
  );
  const identityChanged =
    current.name !== input.name
    || current.academicYearId !== input.academicYearId
    || current.semesterKind !== input.semesterKind
    || toDateOnly(current.startDate) !== input.startDate
    || toDateOnly(current.endDate) !== input.endDate
    || current.isActive !== input.isActive;
  if (identityChanged && !input.confirmUsedChange) {
    const reasons = await semesterUsageLocks(prisma, id);
    if (reasons.length > 0) {
      inUse(`Tanggal dan status tidak diubah karena semester sudah dipakai oleh ${reasons.join(", ")}. Perubahan membutuhkan konfirmasi eksplisit. Data siswa, nilai, presensi, dan rapor tidak dihapus.`);
    }
  }
  await ownedRow(
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }),
    "Tahun pelajaran tidak ditemukan di sekolah ini.",
  );
  await assertSemesterWindow(prisma, schoolId, input, id);
  try {
    await prisma.$transaction(async (tx) => {
      if (input.isActive) await clearActivePeriod(tx, schoolId, id);
      await tx.academicPeriod.update({
        where: { id },
        data: {
          academicYearId: input.academicYearId,
          name: input.name,
          semesterKind: input.semesterKind,
          startDate: parseDateOnly(input.startDate),
          endDate: parseDateOnly(input.endDate),
          isActive: input.isActive,
        },
      });
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "SEMESTER_UPDATED", entityType: "AcademicPeriod", entityId: id });
    const page = await listSemesters(prisma, schoolId, { page: 1, pageSize: 50, q: input.name });
    const updated = page.items.find((item) => item.id === id);
    if (!updated) throw new Error("Semester gagal dimuat ulang.");
    return updated;
  } catch (error) {
    rethrowKnown(error, "Nama semester sudah digunakan di sekolah ini.");
  }
}

export async function deleteSemester(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.academicPeriod.findFirst({ where: { id, schoolId }, select: { id: true } }), "Semester tidak ditemukan.");
  const [teachings, homerooms] = await Promise.all([
    prisma.teachingAssignment.count({ where: { academicPeriodId: id } }),
    prisma.homeroomAssignment.count({ where: { academicPeriodId: id } }),
  ]);
  if (teachings + homerooms > 0) inUse("Semester masih digunakan oleh penugasan guru atau wali kelas.");
  await prisma.academicPeriod.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "SEMESTER_DELETED", entityType: "AcademicPeriod", entityId: id });
}

export async function listFields(prisma: PrismaClient, schoolId: string, query: PageQuery): Promise<PageResult<ExpertiseFieldDto>> {
  const where: Prisma.ExpertiseFieldWhereInput = {
    schoolId,
    ...(query.q ? { OR: [{ name: searchName(query.q) }, { code: searchName(query.q) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expertiseField.findMany({ where, orderBy: { name: "asc" }, ...pageWindow(query) }),
    prisma.expertiseField.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({ id: row.id, schoolId: row.schoolId, code: row.code, name: row.name, isActive: row.isActive })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createField(prisma: PrismaClient, auth: AuthState, schoolId: string, input: NamedInput, meta: RequestMeta) {
  try {
    const row = await prisma.expertiseField.create({ data: { schoolId, ...input } });
    await auditChange(prisma, auth, meta, { schoolId, action: "FIELD_CREATED", entityType: "ExpertiseField", entityId: row.id });
    return { id: row.id, schoolId, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode bidang keahlian sudah digunakan.");
  }
}

export async function updateField(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, input: NamedInput, meta: RequestMeta) {
  await ownedRow(prisma.expertiseField.findFirst({ where: { id, schoolId }, select: { id: true } }), "Bidang keahlian tidak ditemukan.");
  try {
    const row = await prisma.expertiseField.update({ where: { id }, data: input });
    await auditChange(prisma, auth, meta, { schoolId, action: "FIELD_UPDATED", entityType: "ExpertiseField", entityId: id });
    return { id: row.id, schoolId, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode bidang keahlian sudah digunakan.");
  }
}

export async function deleteField(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.expertiseField.findFirst({ where: { id, schoolId }, select: { id: true } }), "Bidang keahlian tidak ditemukan.");
  if (await prisma.expertiseProgram.count({ where: { fieldId: id } })) inUse("Bidang masih memiliki program keahlian.");
  await prisma.expertiseField.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "FIELD_DELETED", entityType: "ExpertiseField", entityId: id });
}

export async function listPrograms(prisma: PrismaClient, schoolId: string, query: PageQuery): Promise<PageResult<ExpertiseProgramDto>> {
  const where: Prisma.ExpertiseProgramWhereInput = {
    schoolId,
    ...(query.q ? { OR: [{ name: searchName(query.q) }, { code: searchName(query.q) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expertiseProgram.findMany({ where, include: { field: { select: { name: true } } }, orderBy: { name: "asc" }, ...pageWindow(query) }),
    prisma.expertiseProgram.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      fieldId: row.fieldId,
      fieldName: row.field.name,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createProgram(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: NamedInput & { fieldId: string },
  meta: RequestMeta,
) {
  await ownedRow(prisma.expertiseField.findFirst({ where: { id: input.fieldId, schoolId }, select: { id: true } }), "Bidang keahlian tidak ditemukan di sekolah ini.");
  try {
    const row = await prisma.expertiseProgram.create({ data: { schoolId, ...input }, include: { field: { select: { name: true } } } });
    await auditChange(prisma, auth, meta, { schoolId, action: "PROGRAM_CREATED", entityType: "ExpertiseProgram", entityId: row.id });
    return { id: row.id, schoolId, fieldId: row.fieldId, fieldName: row.field.name, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode program keahlian sudah digunakan.");
  }
}

export async function updateProgram(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: NamedInput & { fieldId: string },
  meta: RequestMeta,
) {
  await ownedRow(prisma.expertiseProgram.findFirst({ where: { id, schoolId }, select: { id: true } }), "Program keahlian tidak ditemukan.");
  await ownedRow(prisma.expertiseField.findFirst({ where: { id: input.fieldId, schoolId }, select: { id: true } }), "Bidang keahlian tidak ditemukan di sekolah ini.");
  try {
    const row = await prisma.expertiseProgram.update({ where: { id }, data: input, include: { field: { select: { name: true } } } });
    await auditChange(prisma, auth, meta, { schoolId, action: "PROGRAM_UPDATED", entityType: "ExpertiseProgram", entityId: id });
    return { id: row.id, schoolId, fieldId: row.fieldId, fieldName: row.field.name, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode program keahlian sudah digunakan.");
  }
}

export async function deleteProgram(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.expertiseProgram.findFirst({ where: { id, schoolId }, select: { id: true } }), "Program keahlian tidak ditemukan.");
  if (await prisma.expertiseConcentration.count({ where: { programId: id } })) inUse("Program masih memiliki konsentrasi keahlian.");
  await prisma.expertiseProgram.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "PROGRAM_DELETED", entityType: "ExpertiseProgram", entityId: id });
}

export async function listConcentrations(
  prisma: PrismaClient,
  schoolId: string,
  query: PageQuery,
): Promise<PageResult<ExpertiseConcentrationDto>> {
  const where: Prisma.ExpertiseConcentrationWhereInput = {
    schoolId,
    ...(query.q ? { OR: [{ name: searchName(query.q) }, { code: searchName(query.q) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expertiseConcentration.findMany({
      where,
      include: { program: { select: { name: true } } },
      orderBy: { name: "asc" },
      ...pageWindow(query),
    }),
    prisma.expertiseConcentration.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      programId: row.programId,
      programName: row.program.name,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createConcentration(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: NamedInput & { programId: string },
  meta: RequestMeta,
) {
  await ownedRow(prisma.expertiseProgram.findFirst({ where: { id: input.programId, schoolId }, select: { id: true } }), "Program keahlian tidak ditemukan di sekolah ini.");
  try {
    const row = await prisma.expertiseConcentration.create({
      data: { schoolId, ...input },
      include: { program: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CONCENTRATION_CREATED", entityType: "ExpertiseConcentration", entityId: row.id });
    return { id: row.id, schoolId, programId: row.programId, programName: row.program.name, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode konsentrasi keahlian sudah digunakan.");
  }
}

export async function updateConcentration(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: NamedInput & { programId: string },
  meta: RequestMeta,
) {
  await ownedRow(prisma.expertiseConcentration.findFirst({ where: { id, schoolId }, select: { id: true } }), "Konsentrasi keahlian tidak ditemukan.");
  await ownedRow(prisma.expertiseProgram.findFirst({ where: { id: input.programId, schoolId }, select: { id: true } }), "Program keahlian tidak ditemukan di sekolah ini.");
  try {
    const row = await prisma.expertiseConcentration.update({
      where: { id },
      data: input,
      include: { program: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CONCENTRATION_UPDATED", entityType: "ExpertiseConcentration", entityId: id });
    return { id: row.id, schoolId, programId: row.programId, programName: row.program.name, code: row.code, name: row.name, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode konsentrasi keahlian sudah digunakan.");
  }
}

export async function deleteConcentration(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.expertiseConcentration.findFirst({ where: { id, schoolId }, select: { id: true } }), "Konsentrasi keahlian tidak ditemukan.");
  const [classes, students] = await Promise.all([
    prisma.schoolClass.count({ where: { concentrationId: id } }),
    prisma.student.count({ where: { concentrationId: id } }),
  ]);
  if (classes + students > 0) inUse("Konsentrasi masih digunakan oleh kelas atau siswa.");
  await prisma.expertiseConcentration.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "CONCENTRATION_DELETED", entityType: "ExpertiseConcentration", entityId: id });
}

export async function listSubjects(
  prisma: PrismaClient,
  schoolId: string,
  scope: DataScope,
  query: PageQuery,
): Promise<PageResult<SubjectDto>> {
  if (scope.kind === "assigned" && scope.subjectIds.length === 0) return emptyPage(query);
  const where: Prisma.SubjectWhereInput = {
    schoolId,
    ...(scope.kind === "assigned" ? { id: { in: scope.subjectIds } } : {}),
    ...(query.q ? { OR: [{ name: searchName(query.q) }, { code: searchName(query.q) }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.subject.findMany({ where, orderBy: { name: "asc" }, ...pageWindow(query) }),
    prisma.subject.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      code: row.code,
      name: row.name,
      category: row.category,
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createSubject(prisma: PrismaClient, auth: AuthState, schoolId: string, input: SubjectInput, meta: RequestMeta) {
  try {
    const row = await prisma.subject.create({ data: { schoolId, ...input } });
    await auditChange(prisma, auth, meta, { schoolId, action: "SUBJECT_CREATED", entityType: "Subject", entityId: row.id });
    return { id: row.id, schoolId, code: row.code, name: row.name, category: row.category, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode mata pelajaran sudah digunakan.");
  }
}

export async function updateSubject(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: SubjectInput,
  meta: RequestMeta,
) {
  await ownedRow(prisma.subject.findFirst({ where: { id, schoolId }, select: { id: true } }), "Mata pelajaran tidak ditemukan.");
  try {
    const row = await prisma.subject.update({ where: { id }, data: input });
    await auditChange(prisma, auth, meta, { schoolId, action: "SUBJECT_UPDATED", entityType: "Subject", entityId: id });
    return { id: row.id, schoolId, code: row.code, name: row.name, category: row.category, isActive: row.isActive };
  } catch (error) {
    rethrowKnown(error, "Kode mata pelajaran sudah digunakan.");
  }
}

export async function deleteSubject(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.subject.findFirst({ where: { id, schoolId }, select: { id: true } }), "Mata pelajaran tidak ditemukan.");
  const [teachings, placements] = await Promise.all([
    prisma.teachingAssignment.count({ where: { subjectId: id } }),
    prisma.curriculumPlacement.count({ where: { subjectId: id } }),
  ]);
  if (teachings + placements > 0) inUse("Mata pelajaran masih digunakan pada penugasan atau kurikulum.");
  await prisma.subject.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "SUBJECT_DELETED", entityType: "Subject", entityId: id });
}

export async function listClasses(
  prisma: PrismaClient,
  schoolId: string,
  scope: DataScope,
  query: PageQuery,
): Promise<PageResult<SchoolClassDto>> {
  if (scope.kind === "assigned" && scope.classIds.length === 0) return emptyPage(query);
  const where: Prisma.SchoolClassWhereInput = {
    schoolId,
    ...(scope.kind === "assigned" ? { id: { in: scope.classIds } } : {}),
    ...(query.q ? { name: searchName(query.q) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.schoolClass.findMany({
      where,
      include: { academicYear: { select: { name: true } }, concentration: { select: { name: true } } },
      orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
      ...pageWindow(query),
    }),
    prisma.schoolClass.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      concentrationId: row.concentrationId,
      concentrationName: row.concentration?.name ?? null,
      name: row.name,
      gradeLevel: row.gradeLevel,
      capacity: row.capacity,
      isActive: row.isActive,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createClass(prisma: PrismaClient, auth: AuthState, schoolId: string, input: ClassInput, meta: RequestMeta) {
  await ownedRow(prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }), "Tahun pelajaran tidak ditemukan di sekolah ini.");
  if (input.concentrationId) {
    await ownedRow(
      prisma.expertiseConcentration.findFirst({ where: { id: input.concentrationId, schoolId }, select: { id: true } }),
      "Konsentrasi keahlian tidak ditemukan di sekolah ini.",
    );
  }
  try {
    const row = await prisma.schoolClass.create({
      data: { schoolId, ...input },
      include: { academicYear: { select: { name: true } }, concentration: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CLASS_CREATED", entityType: "SchoolClass", entityId: row.id });
    return {
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      concentrationId: row.concentrationId,
      concentrationName: row.concentration?.name ?? null,
      name: row.name,
      gradeLevel: row.gradeLevel,
      capacity: row.capacity,
      isActive: row.isActive,
    };
  } catch (error) {
    rethrowKnown(error, "Nama kelas sudah digunakan pada tahun pelajaran ini.");
  }
}

export async function updateClass(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: ClassInput,
  meta: RequestMeta,
) {
  await ownedRow(prisma.schoolClass.findFirst({ where: { id, schoolId }, select: { id: true } }), "Kelas tidak ditemukan.");
  await ownedRow(prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }), "Tahun pelajaran tidak ditemukan di sekolah ini.");
  if (input.concentrationId) {
    await ownedRow(
      prisma.expertiseConcentration.findFirst({ where: { id: input.concentrationId, schoolId }, select: { id: true } }),
      "Konsentrasi keahlian tidak ditemukan di sekolah ini.",
    );
  }
  try {
    const row = await prisma.schoolClass.update({
      where: { id },
      data: input,
      include: { academicYear: { select: { name: true } }, concentration: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CLASS_UPDATED", entityType: "SchoolClass", entityId: id });
    return {
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      concentrationId: row.concentrationId,
      concentrationName: row.concentration?.name ?? null,
      name: row.name,
      gradeLevel: row.gradeLevel,
      capacity: row.capacity,
      isActive: row.isActive,
    };
  } catch (error) {
    rethrowKnown(error, "Nama kelas sudah digunakan pada tahun pelajaran ini.");
  }
}

export async function deleteClass(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.schoolClass.findFirst({ where: { id, schoolId }, select: { id: true } }), "Kelas tidak ditemukan.");
  const [students, teachings, homerooms, placements] = await Promise.all([
    prisma.student.count({ where: { classId: id } }),
    prisma.teachingAssignment.count({ where: { classId: id } }),
    prisma.homeroomAssignment.count({ where: { classId: id } }),
    prisma.curriculumPlacement.count({ where: { classId: id } }),
  ]);
  if (students + teachings + homerooms + placements > 0) inUse("Kelas masih memiliki siswa, penugasan, atau cakupan kurikulum.");
  await prisma.schoolClass.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "CLASS_DELETED", entityType: "SchoolClass", entityId: id });
}

