import type { AcademicOptionsDto } from "@sims/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DataScope } from "./scope.ts";

const TAKE = 300;

function slotWhere(schoolId: string, scope: DataScope): Prisma.TeachingAssignmentWhereInput {
  if (scope.kind === "all") return { schoolId };
  if (!scope.teacherId && scope.homeroomClassIds.length === 0) return { schoolId, id: { in: [] } };
  return {
    schoolId,
    OR: [
      ...(scope.teacherId ? [{ teacherId: scope.teacherId }] : []),
      ...(scope.homeroomClassIds.length > 0 ? [{ classId: { in: scope.homeroomClassIds } }] : []),
    ],
  };
}

export async function academicOptions(
  prisma: PrismaClient,
  schoolId: string,
  scope: DataScope,
  canManage: boolean,
  canCoordinate: boolean,
): Promise<AcademicOptionsDto> {
  const classWhere = scope.kind === "assigned" ? { schoolId, id: { in: scope.classIds } } : { schoolId };
  const subjectWhere = scope.kind === "assigned" ? { schoolId, id: { in: scope.subjectIds } } : { schoolId };
  const teacherWhere = scope.kind === "assigned" && scope.teacherId ? { schoolId, id: scope.teacherId } : { schoolId };
  const [years, periods, fields, programs, concentrations, teachers, classes, subjects, members, curricula, slots] = await Promise.all([
    prisma.academicYear.findMany({ where: { schoolId }, orderBy: { name: "desc" }, take: TAKE }),
    prisma.academicPeriod.findMany({ where: { schoolId }, orderBy: { startDate: "desc" }, take: TAKE }),
    prisma.expertiseField.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, take: TAKE }),
    prisma.expertiseProgram.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, take: TAKE }),
    prisma.expertiseConcentration.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, take: TAKE }),
    scope.kind === "assigned" && !scope.teacherId
      ? Promise.resolve([])
      : prisma.teacher.findMany({ where: { ...teacherWhere, isActive: true }, orderBy: { name: "asc" }, take: TAKE }),
    scope.kind === "assigned" && scope.classIds.length === 0
      ? Promise.resolve([])
      : prisma.schoolClass.findMany({
          where: { ...classWhere, isActive: true },
          select: { id: true, name: true, concentrationId: true, academicYear: { select: { isActive: true } } },
          orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
          take: TAKE,
        }),
    scope.kind === "assigned" && scope.subjectIds.length === 0
      ? Promise.resolve([])
      : prisma.subject.findMany({ where: { ...subjectWhere, isActive: true }, orderBy: { name: "asc" }, take: TAKE }),
    canManage
      ? prisma.userRole.findMany({
          where: { schoolId, isActive: true, user: { isActive: true } },
          include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } },
          take: TAKE,
        })
      : Promise.resolve([]),
    prisma.curriculum.findMany({
      where: { schoolId },
      include: { academicYear: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: TAKE,
    }),
    prisma.teachingAssignment.findMany({
      where: slotWhere(schoolId, scope),
      include: {
        teacher: { select: { name: true } },
        class: { select: { name: true } },
        subject: { select: { name: true } },
        academicPeriod: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  ]);

  const memberMap = new Map<string, { id: string; label: string; roles: string[] }>();
  if (Array.isArray(members)) {
    for (const member of members) {
      const current = memberMap.get(member.user.id);
      const roles = current?.roles ?? [];
      if (!roles.includes(member.role.name)) roles.push(member.role.name);
      memberMap.set(member.user.id, {
        id: member.user.id,
        label: `${member.user.name} · ${roles.join(", ")}`,
        roles,
      });
    }
  }

  return {
    years: years.map((item) => ({ id: item.id, label: item.name })),
    periods: periods.map((item) => ({ id: item.id, label: item.name })),
    fields: fields.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })),
    programs: programs.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })),
    concentrations: concentrations.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })),
    teachers: teachers.map((item) => ({ id: item.id, label: item.nip ? `${item.name} · ${item.nip}` : item.name })),
    classes: classes.map((item) => ({
      id: item.id,
      label: item.name,
      concentrationId: item.concentrationId,
      academicYearActive: item.academicYear.isActive,
    })),
    subjects: subjects.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })),
    members: [...memberMap.values()].map(({ id, label }) => ({ id, label })),
    curricula: curricula.map((item) => ({ id: item.id, label: `${item.code} · ${item.name} · ${item.academicYear.name}` })),
    planSlots: slots.map((item) => ({
      id: item.id,
      classId: item.classId,
      className: item.class.name,
      subjectId: item.subjectId,
      subjectName: item.subject.name,
      academicPeriodId: item.academicPeriodId,
      periodName: item.academicPeriod.name,
      teacherName: item.teacher.name,
      writable: canCoordinate || (scope.kind === "assigned" && scope.teacherId === item.teacherId),
    })),
  };
}
