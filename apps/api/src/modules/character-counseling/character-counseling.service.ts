import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { assertSchoolAccess, assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const COUNSELING_STAFF_ROLES = ["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "WAKAKUR", "WALI_KELAS", "TU", "WAKA_KESISWAAN"] as const;

export async function listCharacterRecords(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, COUNSELING_STAFF_ROLES, meta);
  const records = await prisma.studentCharacterRecord.findMany({
    where: { schoolId },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          nis: true,
          class: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ occurredAt: "desc" }],
    take: 150,
  });

  const totalsByStudent = new Map<string, number>();
  for (const r of records) {
    const delta = r.recordType === "PRESTASI" ? r.points : -r.points;
    totalsByStudent.set(r.studentId, (totalsByStudent.get(r.studentId) ?? 0) + delta);
  }

  return {
    records: records.map((r) => ({
      ...r,
      netScore: totalsByStudent.get(r.studentId) ?? 0,
    })),
  };
}

export async function createCharacterRecord(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    studentId: string;
    recordType: "PRESTASI" | "PELANGGARAN";
    category: string;
    points: number;
    note: string;
  },
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, COUNSELING_STAFF_ROLES, meta);
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId },
    select: { id: true, name: true },
  });
  if (!student) {
    throw new AppError(404, "STUDENT_NOT_FOUND", "Data siswa tidak ditemukan pada sekolah ini.");
  }

  const actorUser = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { name: true, email: true },
  });

  const record = await prisma.studentCharacterRecord.create({
    data: {
      schoolId,
      studentId: student.id,
      recordType: input.recordType,
      category: input.category.trim(),
      points: input.points,
      note: input.note.trim(),
      recordedBy: actorUser?.name ?? actorUser?.email ?? auth.userId,
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          nis: true,
          class: { select: { id: true, name: true } },
        },
      },
    },
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: auth.userId,
    action: "STUDENT_CHARACTER_RECORD_CREATED",
    entityType: "StudentCharacterRecord",
    entityId: record.id,
    metadata: { studentId: student.id, recordType: input.recordType, points: input.points },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { record };
}

export async function listCounselingReports(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  await assertSchoolAccess(prisma, auth, schoolId, meta);
  const canManageAll =
    auth.isSystemOwner ||
    auth.assignments.some(
      (a) => a.schoolId === schoolId && COUNSELING_STAFF_ROLES.includes(a.roleCode as (typeof COUNSELING_STAFF_ROLES)[number]),
    );

  const reports = await prisma.counselingReport.findMany({
    where: {
      schoolId,
      ...(canManageAll ? {} : { reporterUserId: auth.userId }),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          class: { select: { name: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  return {
    canManageAll,
    reports: reports.map((rep) => ({
      ...rep,
      reporterUserId: rep.isAnonymous ? null : rep.reporterUserId,
      reporterLabel: rep.isAnonymous ? "Anonim (Dilindungi)" : "Terdaftar",
    })),
  };
}

export async function createCounselingReport(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    studentId?: string | null;
    isAnonymous?: boolean;
    subject: string;
    description: string;
  },
  meta: RequestMeta,
) {
  await assertSchoolAccess(prisma, auth, schoolId, meta);

  if (input.studentId) {
    const student = await prisma.student.findFirst({ where: { id: input.studentId, schoolId }, select: { id: true } });
    if (!student) {
      throw new AppError(404, "STUDENT_NOT_FOUND", "Siswa tidak ditemukan pada sekolah ini.");
    }
  }

  const report = await prisma.counselingReport.create({
    data: {
      schoolId,
      studentId: input.studentId ?? null,
      reporterUserId: auth.userId,
      isAnonymous: Boolean(input.isAnonymous),
      subject: input.subject.trim(),
      description: input.description.trim(),
    },
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: input.isAnonymous ? null : auth.userId,
    action: "COUNSELING_REPORT_CREATED",
    entityType: "CounselingReport",
    entityId: report.id,
    metadata: { isAnonymous: report.isAnonymous, status: report.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { report };
}

export async function updateCounselingReport(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: { status: "BARU" | "DIPROSES" | "SELESAI"; counselorNote?: string | null },
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, COUNSELING_STAFF_ROLES, meta);
  const existing = await prisma.counselingReport.findFirst({ where: { id, schoolId } });
  if (!existing) {
    throw new AppError(404, "COUNSELING_REPORT_NOT_FOUND", "Laporan konseling tidak ditemukan.");
  }

  const report = await prisma.counselingReport.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      counselorNote: input.counselorNote?.trim() || null,
    },
  });

  return {
    report: {
      ...report,
      reporterUserId: report.isAnonymous ? null : report.reporterUserId,
    },
  };
}
