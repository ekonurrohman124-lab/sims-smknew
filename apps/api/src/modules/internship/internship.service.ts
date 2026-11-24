import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const PKL_BROAD_ROLES = ["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "WAKAKUR", "TU", "WAKA_KESISWAAN", "WAKA_HUMAS", "KAPROG"] as const;

async function internshipScope(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
  write: boolean,
): Promise<{ all: true } | { all: false; studentIds: string[] }> {
  const broad =
    auth.isSystemOwner ||
    auth.assignments.some(
      (assignment) => assignment.schoolId === schoolId && PKL_BROAD_ROLES.includes(assignment.roleCode as (typeof PKL_BROAD_ROLES)[number]),
    );
  if (broad) return { all: true };

  const isHomeroom = auth.assignments.some((assignment) => assignment.schoolId === schoolId && assignment.roleCode === "WALI_KELAS");
  if (isHomeroom) {
    const teacher = await prisma.teacher.findFirst({ where: { schoolId, userId: auth.userId }, select: { id: true } });
    const rooms = teacher
      ? await prisma.homeroomAssignment.findMany({ where: { schoolId, teacherId: teacher.id }, select: { classId: true } })
      : [];
    const classIds = rooms.map((room) => room.classId);
    const students = classIds.length === 0
      ? []
      : await prisma.student.findMany({ where: { schoolId, classId: { in: classIds } }, select: { id: true } });
    return { all: false, studentIds: students.map((student) => student.id) };
  }

  if (!write) {
    const links = await prisma.parentStudentLink.findMany({
      where: { schoolId, parentUserId: auth.userId },
      select: { studentId: true },
    });
    if (links.length > 0) return { all: false, studentIds: links.map((link) => link.studentId) };
  }

  await assertSchoolRole(prisma, auth, schoolId, PKL_BROAD_ROLES, meta);
  return { all: true };
}

function placementFilter(scope: { all: true } | { all: false; studentIds: string[] }) {
  return scope.all ? {} : { studentId: { in: scope.studentIds } };
}

export async function listInternshipPlacements(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  const scope = await internshipScope(prisma, auth, schoolId, meta, false);
  const canManageAll = scope.all;

  const placements = await prisma.internshipPlacement.findMany({
    where: {
      schoolId,
      ...placementFilter(scope),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          class: { select: { name: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 150,
  });

  return { canManageAll, placements };
}

export async function createInternshipPlacement(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    studentId: string;
    companyName: string;
    companyAddress?: string | null;
    supervisorName?: string | null;
    startDate: string;
    endDate: string;
  },
  meta: RequestMeta,
) {
  const scope = await internshipScope(prisma, auth, schoolId, meta, true);
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId },
    select: { id: true },
  });
  if (!student) {
    throw new AppError(404, "STUDENT_NOT_FOUND", "Siswa tidak ditemukan pada sekolah ini.");
  }
  if (!scope.all && !scope.studentIds.includes(student.id)) {
    throw new AppError(403, "TENANT_FORBIDDEN", "Anda tidak memiliki akses ke data sekolah ini.");
  }

  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  if (end < start) {
    throw new AppError(400, "INVALID_DATE_RANGE", "Tanggal selesai PKL tidak boleh lebih awal dari tanggal mulai.");
  }

  const placement = await prisma.internshipPlacement.create({
    data: {
      schoolId,
      studentId: student.id,
      companyName: input.companyName.trim(),
      companyAddress: input.companyAddress?.trim() || null,
      supervisorName: input.supervisorName?.trim() || null,
      startDate: start,
      endDate: end,
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          class: { select: { name: true } },
        },
      },
    },
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: auth.userId,
    action: "INTERNSHIP_PLACEMENT_CREATED",
    entityType: "InternshipPlacement",
    entityId: placement.id,
    metadata: { studentId: student.id, companyName: placement.companyName },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { placement };
}

export async function listInternshipLogs(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  const scope = await internshipScope(prisma, auth, schoolId, meta, false);
  const canVerify = scope.all || auth.assignments.some((assignment) => assignment.schoolId === schoolId && assignment.roleCode === "WALI_KELAS");

  const logs = await prisma.internshipLog.findMany({
    where: {
      schoolId,
      ...placementFilter(scope),
    },
    include: {
      placement: { select: { id: true, companyName: true } },
      student: { select: { id: true, name: true, class: { select: { name: true } } } },
      verifiedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ logDate: "desc" }, { createdAt: "desc" }],
    take: 150,
  });

  return { canVerify, logs };
}

export async function createInternshipLog(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    placementId: string;
    logDate: string;
    activity: string;
    locationNote?: string | null;
  },
  meta: RequestMeta,
) {
  const scope = await internshipScope(prisma, auth, schoolId, meta, true);

  const placement = await prisma.internshipPlacement.findFirst({
    where: { id: input.placementId, schoolId },
  });
  if (!placement || (!scope.all && !scope.studentIds.includes(placement.studentId))) {
    throw new AppError(404, "PLACEMENT_NOT_FOUND", "Penempatan PKL tidak ditemukan.");
  }

  const logDateObj = new Date(`${input.logDate}T00:00:00.000Z`);

  const log = await prisma.internshipLog.upsert({
    where: {
      placementId_logDate: {
        placementId: placement.id,
        logDate: logDateObj,
      },
    },
    update: {
      activity: input.activity.trim(),
      locationNote: input.locationNote?.trim() || null,
      status: "MENUNGGU",
    },
    create: {
      schoolId,
      placementId: placement.id,
      studentId: placement.studentId,
      logDate: logDateObj,
      activity: input.activity.trim(),
      locationNote: input.locationNote?.trim() || null,
    },
    include: {
      placement: { select: { id: true, companyName: true } },
      student: { select: { id: true, name: true, class: { select: { name: true } } } },
      verifiedBy: { select: { id: true, name: true } },
    },
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: auth.userId,
    action: "INTERNSHIP_LOG_SAVED",
    entityType: "InternshipLog",
    entityId: log.id,
    metadata: { placementId: placement.id, logDate: input.logDate },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { log };
}

export async function verifyInternshipLog(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  logId: string,
  input: { status: "DISETUJUI" | "REVISI" },
  meta: RequestMeta,
) {
  const scope = await internshipScope(prisma, auth, schoolId, meta, true);

  const existing = await prisma.internshipLog.findFirst({
    where: { id: logId, schoolId },
  });
  if (!existing || (!scope.all && !scope.studentIds.includes(existing.studentId))) {
    throw new AppError(404, "INTERNSHIP_LOG_NOT_FOUND", "Jurnal PKL tidak ditemukan.");
  }

  const log = await prisma.internshipLog.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      verifiedById: auth.userId,
      verifiedAt: new Date(),
    },
    include: {
      placement: { select: { id: true, companyName: true } },
      student: { select: { id: true, name: true, class: { select: { name: true } } } },
      verifiedBy: { select: { id: true, name: true } },
    },
  });

  return { log };
}
