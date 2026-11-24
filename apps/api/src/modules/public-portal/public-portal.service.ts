import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { RoleCode } from "@sims/shared";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const SCHOOL_ALL_ROLES: RoleCode[] = [
  "SYSTEM_OWNER",
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
  "GURU_MAPEL",
  "WALI_KELAS",
];

const PPDB_ADMIN_ROLES: RoleCode[] = [
  "SYSTEM_OWNER",
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
  "WAKA_HUMAS",
];

const COUNSELING_ROLES: RoleCode[] = [
  "SYSTEM_OWNER",
  "ADMIN_SEKOLAH",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
  "WALI_KELAS",
  "WAKA_KESISWAAN",
];

export async function listPpdbApplicants(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PPDB_ADMIN_ROLES, meta);
  const items = await prisma.ppdbApplicant.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
  return items.map((item) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function createPpdbApplicant(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    fullName: string;
    nisn?: string;
    originSchool: string;
    chosenMajor: string;
    parentPhone: string;
    averageScore?: number;
    notes?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PPDB_ADMIN_ROLES, meta);
  const recentApplicant = await prisma.ppdbApplicant.findFirst({
    where: {
      schoolId,
      fullName: input.fullName,
      originSchool: input.originSchool,
      parentPhone: input.parentPhone,
      chosenMajor: input.chosenMajor,
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentApplicant) {
    return {
      ...recentApplicant,
      createdAt: recentApplicant.createdAt.toISOString(),
      updatedAt: recentApplicant.updatedAt.toISOString(),
    };
  }
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const registrationNo = `PPDB-${year}-${suffix}`;

  const created = await prisma.ppdbApplicant.create({
    data: {
      schoolId,
      registrationNo,
      fullName: input.fullName,
      nisn: input.nisn ?? null,
      originSchool: input.originSchool,
      chosenMajor: input.chosenMajor,
      parentPhone: input.parentPhone,
      averageScore: input.averageScore ?? null,
      notes: input.notes ?? null,
      status: "MENDAFTAR",
    },
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "PPDB_APPLICANT_CREATED",
    entityType: "PpdbApplicant",
    entityId: created.id,
    metadata: { registrationNo: created.registrationNo, chosenMajor: created.chosenMajor },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function updatePpdbApplicantStatus(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  applicantId: string,
  input: {
    status: "MENDAFTAR" | "TERVERIFIKASI" | "DITERIMA" | "CADANGAN" | "DITOLAK";
    notes?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PPDB_ADMIN_ROLES, meta);
  const existing = await prisma.ppdbApplicant.findFirst({
    where: { id: applicantId, schoolId },
  });
  if (!existing) {
    throw new AppError(404, "PPDB_APPLICANT_NOT_FOUND", "Data pendaftar PPDB tidak ditemukan.");
  }

  const updated = await prisma.ppdbApplicant.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    },
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "PPDB_APPLICANT_UPDATED",
    entityType: "PpdbApplicant",
    entityId: updated.id,
    metadata: { status: updated.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

function presentReport(item: {
  id: string;
  schoolId: string;
  ticketCode: string;
  category: "PERUNDUNGAN_BULLYING" | "KEKERASAN_FISIK_VERBAL" | "FASILITAS_KEAMANAN" | "LAINNYA";
  incidentPlace: string | null;
  description: string;
  status: "BARU" | "DITINDAKLANJUTI" | "SELESAI";
  counselorReply: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    schoolId: item.schoolId,
    ticketCode: item.ticketCode,
    category: item.category,
    incidentPlace: item.incidentPlace,
    description: item.description,
    status: item.status,
    counselorReply: item.counselorReply,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function listAnonymousReports(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, COUNSELING_ROLES, meta);
  const items = await prisma.anonymousReport.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
  return items.map(presentReport);
}

export async function createAnonymousReport(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    category?: "PERUNDUNGAN_BULLYING" | "KEKERASAN_FISIK_VERBAL" | "FASILITAS_KEAMANAN" | "LAINNYA";
    incidentPlace?: string;
    description: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, SCHOOL_ALL_ROLES, meta);
  const recentReport = await prisma.anonymousReport.findFirst({
    where: {
      schoolId,
      category: input.category ?? "PERUNDUNGAN_BULLYING",
      description: input.description,
      incidentPlace: input.incidentPlace ?? null,
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentReport) return presentReport(recentReport);
  const ticketCode = `SAFE-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const created = await prisma.anonymousReport.create({
    data: {
      schoolId,
      ticketCode,
      category: input.category ?? "PERUNDUNGAN_BULLYING",
      incidentPlace: input.incidentPlace ?? null,
      description: input.description,
      status: "BARU",
    },
  });

  await writeAudit(prisma, {
    actorId: null,
    schoolId,
    action: "ANONYMOUS_REPORT_SUBMITTED",
    entityType: "AnonymousReport",
    entityId: created.id,
    metadata: { ticketCode: created.ticketCode, category: created.category },
    ipAddress: null,
    userAgent: null,
  });

  return presentReport(created);
}

export async function updateAnonymousReport(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  reportId: string,
  input: {
    status: "BARU" | "DITINDAKLANJUTI" | "SELESAI";
    counselorReply?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, COUNSELING_ROLES, meta);
  const existing = await prisma.anonymousReport.findFirst({
    where: { id: reportId, schoolId },
  });
  if (!existing) {
    throw new AppError(404, "REPORT_NOT_FOUND", "Laporan tiket tidak ditemukan.");
  }

  const updated = await prisma.anonymousReport.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      counselorReply: input.counselorReply !== undefined ? input.counselorReply : existing.counselorReply,
    },
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "ANONYMOUS_REPORT_UPDATED",
    entityType: "AnonymousReport",
    entityId: updated.id,
    metadata: { status: updated.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return presentReport(updated);
}
