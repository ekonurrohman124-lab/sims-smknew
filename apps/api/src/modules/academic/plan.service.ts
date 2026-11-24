import type { CurriculumDto, CurriculumPlacementDto, PageResult, PlanItemDto } from "@sims/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { MSG } from "../../lib/messages.ts";
import type { RequestMeta } from "../../lib/tenant.ts";
import type { PlanItemInput, PlanQuery, PlanUpdateInput } from "./academic.schema.ts";
import {
  auditChange,
  duplicate,
  inUse,
  invalidReference,
  ownedRow,
  pageWindow,
  rethrowKnown,
  type PageQuery,
} from "./common.ts";
import type { PlanAccess } from "./scope.ts";
import { curriculumBlueprint, curriculumReviewNotes } from "./vocational-master.catalog.ts";

function curriculumReview(code: string): Pick<CurriculumDto, "reviewLabel" | "reviewNotes"> {
  if (code !== curriculumBlueprint.code) return { reviewLabel: null, reviewNotes: [] };
  return { reviewLabel: "PERLU VERIFIKASI", reviewNotes: [...curriculumReviewNotes] };
}

type CurriculumInput = {
  academicYearId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};
type PlacementInput = { curriculumId: string; classId: string; subjectId: string };
type PlanKind = "objective" | "scope";

const planInclude = {
  teachingAssignment: {
    include: {
      teacher: { select: { name: true } },
      subject: { select: { name: true } },
      class: { select: { name: true } },
      academicPeriod: { select: { name: true, academicYearId: true } },
    },
  },
} satisfies Prisma.LearningObjectiveInclude;

type PlanRow = {
  id: string;
  schoolId: string;
  teachingAssignmentId: string;
  curriculumId: string | null;
  code: string;
  description: string;
  sequence: number;
  teachingAssignment: {
    teacher: { name: string };
    subjectId: string;
    subject: { name: string };
    classId: string;
    class: { name: string };
    academicPeriodId: string;
    academicPeriod: { name: string };
  };
};

function planName(kind: PlanKind): string {
  return kind === "objective" ? "Tujuan pembelajaran" : "Lingkup materi";
}

function visibilityWhere(access: PlanAccess): Prisma.TeachingAssignmentWhereInput {
  if (access.readAll) return {};
  if (!access.teacherId && access.homeroomClassIds.length === 0) return { id: { in: [] } };
  return {
    OR: [
      ...(access.teacherId ? [{ teacherId: access.teacherId }] : []),
      ...(access.homeroomClassIds.length > 0 ? [{ classId: { in: access.homeroomClassIds } }] : []),
    ],
  };
}

function toPlanItem(row: PlanRow): PlanItemDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    teachingAssignmentId: row.teachingAssignmentId,
    curriculumId: row.curriculumId,
    code: row.code,
    description: row.description,
    sequence: row.sequence,
    teacherName: row.teachingAssignment.teacher.name,
    subjectId: row.teachingAssignment.subjectId,
    subjectName: row.teachingAssignment.subject.name,
    classId: row.teachingAssignment.classId,
    className: row.teachingAssignment.class.name,
    academicPeriodId: row.teachingAssignment.academicPeriodId,
    periodName: row.teachingAssignment.academicPeriod.name,
  };
}

async function matchingCurriculum(
  prisma: PrismaClient,
  schoolId: string,
  classId: string,
  subjectId: string,
  academicYearId: string | null,
) {
  if (!academicYearId) return null;
  const placement = await prisma.curriculumPlacement.findFirst({
    where: { schoolId, classId, subjectId, curriculum: { academicYearId, isActive: true } },
    orderBy: { createdAt: "asc" },
    select: { curriculumId: true },
  });
  return placement?.curriculumId ?? null;
}

async function requireAssignment(prisma: PrismaClient, schoolId: string, input: PlanItemInput, access: PlanAccess) {
  const assignment = await prisma.teachingAssignment.findFirst({
    where: {
      schoolId,
      classId: input.classId,
      subjectId: input.subjectId,
      academicPeriodId: input.academicPeriodId,
    },
    include: { academicPeriod: { select: { academicYearId: true } } },
  });
  if (!assignment) invalidReference("Belum ada penugasan guru untuk kelas, mapel, dan semester ini.");
  if (!access.writeAll && assignment.teacherId !== access.teacherId) {
    throw new AppError(403, "FORBIDDEN", MSG.forbidden);
  }
  return assignment;
}

function assertWritable(access: PlanAccess, teacherId: string) {
  if (!access.writeAll && access.teacherId !== teacherId) {
    throw new AppError(403, "FORBIDDEN", MSG.forbidden);
  }
}

export async function listCurricula(
  prisma: PrismaClient,
  schoolId: string,
  query: PageQuery,
): Promise<PageResult<CurriculumDto>> {
  const where: Prisma.CurriculumWhereInput = {
    schoolId,
    ...(query.q
      ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { code: { contains: query.q, mode: "insensitive" } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.curriculum.findMany({
      where,
      include: { academicYear: { select: { name: true } } },
      orderBy: { name: "asc" },
      ...pageWindow(query),
    }),
    prisma.curriculum.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      code: row.code,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      ...curriculumReview(row.code),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createCurriculum(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: CurriculumInput,
  meta: RequestMeta,
) {
  await ownedRow(
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }),
    "Tahun pelajaran tidak ditemukan di sekolah ini.",
  );
  try {
    const row = await prisma.curriculum.create({
      data: { schoolId, ...input },
      include: { academicYear: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CURRICULUM_CREATED", entityType: "Curriculum", entityId: row.id });
    return {
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      code: row.code,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      ...curriculumReview(row.code),
    };
  } catch (error) {
    rethrowKnown(error, "Kode kurikulum sudah digunakan pada tahun pelajaran ini.");
  }
}

export async function updateCurriculum(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: CurriculumInput,
  meta: RequestMeta,
) {
  await ownedRow(prisma.curriculum.findFirst({ where: { id, schoolId }, select: { id: true } }), "Kurikulum tidak ditemukan.");
  await ownedRow(
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, schoolId }, select: { id: true } }),
    "Tahun pelajaran tidak ditemukan di sekolah ini.",
  );
  try {
    const row = await prisma.curriculum.update({
      where: { id },
      data: input,
      include: { academicYear: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "CURRICULUM_UPDATED", entityType: "Curriculum", entityId: id });
    return {
      id: row.id,
      schoolId,
      academicYearId: row.academicYearId,
      academicYearName: row.academicYear.name,
      code: row.code,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      ...curriculumReview(row.code),
    };
  } catch (error) {
    rethrowKnown(error, "Kode kurikulum sudah digunakan pada tahun pelajaran ini.");
  }
}

export async function deleteCurriculum(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.curriculum.findFirst({ where: { id, schoolId }, select: { id: true } }), "Kurikulum tidak ditemukan.");
  await prisma.curriculum.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "CURRICULUM_DELETED", entityType: "Curriculum", entityId: id });
}

export async function listPlacements(
  prisma: PrismaClient,
  schoolId: string,
  query: PageQuery,
): Promise<PageResult<CurriculumPlacementDto>> {
  const where: Prisma.CurriculumPlacementWhereInput = {
    schoolId,
    ...(query.q
      ? {
          OR: [
            { curriculum: { name: { contains: query.q, mode: "insensitive" } } },
            { class: { name: { contains: query.q, mode: "insensitive" } } },
            { subject: { name: { contains: query.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.curriculumPlacement.findMany({
      where,
      include: {
        curriculum: { select: { name: true } },
        class: { select: { name: true } },
        subject: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      ...pageWindow(query),
    }),
    prisma.curriculumPlacement.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      schoolId,
      curriculumId: row.curriculumId,
      curriculumName: row.curriculum.name,
      classId: row.classId,
      className: row.class.name,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createPlacement(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: PlacementInput,
  meta: RequestMeta,
) {
  const curriculum = await ownedRow(
    prisma.curriculum.findFirst({ where: { id: input.curriculumId, schoolId }, select: { id: true, academicYearId: true, name: true } }),
    "Kurikulum tidak ditemukan.",
  );
  const schoolClass = await ownedRow(
    prisma.schoolClass.findFirst({ where: { id: input.classId, schoolId }, select: { id: true, academicYearId: true, name: true } }),
    "Kelas tidak ditemukan di sekolah ini.",
  );
  if (schoolClass.academicYearId !== curriculum.academicYearId) {
    invalidReference("Kelas tidak berada pada tahun pelajaran kurikulum ini.");
  }
  const subject = await ownedRow(
    prisma.subject.findFirst({ where: { id: input.subjectId, schoolId }, select: { id: true, name: true } }),
    "Mata pelajaran tidak ditemukan di sekolah ini.",
  );
  const existing = await prisma.curriculumPlacement.findFirst({
    where: { curriculumId: input.curriculumId, classId: input.classId, subjectId: input.subjectId },
    select: { id: true },
  });
  if (existing) duplicate("Mapel ini sudah masuk pada kurikulum untuk kelas tersebut.");
  try {
    const row = await prisma.curriculumPlacement.create({ data: { schoolId, ...input } });
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: "PLACEMENT_CREATED",
      entityType: "CurriculumPlacement",
      entityId: row.id,
    });
    return {
      id: row.id,
      schoolId,
      curriculumId: input.curriculumId,
      curriculumName: curriculum.name,
      classId: input.classId,
      className: schoolClass.name,
      subjectId: input.subjectId,
      subjectName: subject.name,
    };
  } catch (error) {
    rethrowKnown(error, "Mapel ini sudah masuk pada kurikulum untuk kelas tersebut.");
  }
}

export async function deletePlacement(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.curriculumPlacement.findFirst({ where: { id, schoolId }, select: { id: true } }), "Cakupan kurikulum tidak ditemukan.");
  await prisma.curriculumPlacement.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "PLACEMENT_DELETED", entityType: "CurriculumPlacement", entityId: id });
}

export async function listPlanItems(
  prisma: PrismaClient,
  schoolId: string,
  access: PlanAccess,
  query: PlanQuery,
  kind: PlanKind,
): Promise<PageResult<PlanItemDto>> {
  const where: Prisma.LearningObjectiveWhereInput = {
    schoolId,
    ...(query.q
      ? {
          OR: [
            { code: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
    teachingAssignment: {
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.academicPeriodId ? { academicPeriodId: query.academicPeriodId } : {}),
      ...visibilityWhere(access),
    },
  };
  const orderBy = [{ sequence: "asc" as const }, { code: "asc" as const }];
  const window = pageWindow(query);
  const [rows, total] =
    kind === "objective"
      ? await Promise.all([
          prisma.learningObjective.findMany({ where, include: planInclude, orderBy, ...window }),
          prisma.learningObjective.count({ where }),
        ])
      : await Promise.all([
          prisma.materialScope.findMany({
            where: where as Prisma.MaterialScopeWhereInput,
            include: planInclude,
            orderBy,
            ...window,
          }),
          prisma.materialScope.count({ where: where as Prisma.MaterialScopeWhereInput }),
        ]);
  return { items: rows.map(toPlanItem), total, page: query.page, pageSize: query.pageSize };
}

async function nextSequence(prisma: PrismaClient, teachingAssignmentId: string, kind: PlanKind) {
  const aggregate =
    kind === "objective"
      ? await prisma.learningObjective.aggregate({ where: { teachingAssignmentId }, _max: { sequence: true } })
      : await prisma.materialScope.aggregate({ where: { teachingAssignmentId }, _max: { sequence: true } });
  return (aggregate._max.sequence ?? 0) + 1;
}

async function nextCode(prisma: PrismaClient, teachingAssignmentId: string, kind: PlanKind) {
  const prefix = kind === "objective" ? "TP" : "LM";
  let number =
    (kind === "objective"
      ? await prisma.learningObjective.count({ where: { teachingAssignmentId } })
      : await prisma.materialScope.count({ where: { teachingAssignmentId } })) + 1;
  for (;;) {
    const code = `${prefix}-${number}`;
    const exists =
      kind === "objective"
        ? await prisma.learningObjective.findFirst({ where: { teachingAssignmentId, code }, select: { id: true } })
        : await prisma.materialScope.findFirst({ where: { teachingAssignmentId, code }, select: { id: true } });
    if (!exists) return code;
    number += 1;
  }
}

export async function createPlanItem(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  access: PlanAccess,
  input: PlanItemInput,
  meta: RequestMeta,
  kind: PlanKind,
) {
  const assignment = await requireAssignment(prisma, schoolId, input, access);
  const code = input.code ?? (await nextCode(prisma, assignment.id, kind));
  const sequence = input.sequence ?? (await nextSequence(prisma, assignment.id, kind));
  const curriculumId = await matchingCurriculum(
    prisma,
    schoolId,
    assignment.classId,
    assignment.subjectId,
    assignment.academicPeriod.academicYearId,
  );
  try {
    const row =
      kind === "objective"
        ? await prisma.learningObjective.create({
            data: { schoolId, teachingAssignmentId: assignment.id, curriculumId, code, description: input.description, sequence },
            include: planInclude,
          })
        : await prisma.materialScope.create({
            data: { schoolId, teachingAssignmentId: assignment.id, curriculumId, code, description: input.description, sequence },
            include: planInclude,
          });
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: kind === "objective" ? "OBJECTIVE_CREATED" : "SCOPE_CREATED",
      entityType: kind === "objective" ? "LearningObjective" : "MaterialScope",
      entityId: row.id,
    });
    return toPlanItem(row);
  } catch (error) {
    rethrowKnown(error, `Kode ${planName(kind).toLowerCase()} sudah digunakan pada penugasan ini.`);
  }
}

export async function updatePlanItem(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  access: PlanAccess,
  id: string,
  input: PlanUpdateInput,
  meta: RequestMeta,
  kind: PlanKind,
) {
  const current =
    kind === "objective"
      ? await prisma.learningObjective.findFirst({ where: { id, schoolId }, include: { teachingAssignment: { select: { teacherId: true } } } })
      : await prisma.materialScope.findFirst({ where: { id, schoolId }, include: { teachingAssignment: { select: { teacherId: true } } } });
  if (!current) invalidReference(`${planName(kind)} tidak ditemukan.`);
  assertWritable(access, current.teachingAssignment.teacherId);
  try {
    const row =
      kind === "objective"
        ? await prisma.learningObjective.update({ where: { id }, data: input, include: planInclude })
        : await prisma.materialScope.update({ where: { id }, data: input, include: planInclude });
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: kind === "objective" ? "OBJECTIVE_UPDATED" : "SCOPE_UPDATED",
      entityType: kind === "objective" ? "LearningObjective" : "MaterialScope",
      entityId: id,
    });
    return toPlanItem(row);
  } catch (error) {
    rethrowKnown(error, `Kode ${planName(kind).toLowerCase()} sudah digunakan pada penugasan ini.`);
  }
}

export async function deletePlanItem(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  access: PlanAccess,
  id: string,
  meta: RequestMeta,
  kind: PlanKind,
) {
  const current =
    kind === "objective"
      ? await prisma.learningObjective.findFirst({ where: { id, schoolId }, include: { teachingAssignment: { select: { teacherId: true } } } })
      : await prisma.materialScope.findFirst({ where: { id, schoolId }, include: { teachingAssignment: { select: { teacherId: true } } } });
  if (!current) invalidReference(`${planName(kind)} tidak ditemukan.`);
  assertWritable(access, current.teachingAssignment.teacherId);
  if (kind === "objective") {
    if (await prisma.formativeAssessment.count({ where: { learningObjectiveId: id } })) {
      inUse("Tujuan pembelajaran sudah dipakai penilaian formatif.");
    }
    await prisma.learningObjective.delete({ where: { id } });
  } else {
    if (await prisma.summativeAssessment.count({ where: { materialScopeId: id } })) {
      inUse("Lingkup materi sudah dipakai penilaian sumatif.");
    }
    await prisma.materialScope.delete({ where: { id } });
  }
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: kind === "objective" ? "OBJECTIVE_DELETED" : "SCOPE_DELETED",
    entityType: kind === "objective" ? "LearningObjective" : "MaterialScope",
    entityId: id,
  });
}
