import type { Prisma, PrismaClient } from "@prisma/client";
import type { RoleCode } from "@sims/shared";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const PAYROLL_ADMIN_ROLES: RoleCode[] = ["SYSTEM_OWNER", "ADMIN_SEKOLAH", "TU"];
const STAFF_OR_TEACHER_ROLES: RoleCode[] = [
  "SYSTEM_OWNER",
  "ADMIN_SEKOLAH",
  "TU",
  "GURU_MAPEL",
  "WALI_KELAS",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
];

const MONTH_NAMES = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function computeNetPay(params: {
  baseHonor: number;
  attendanceBonus: number;
  positionBonus: number;
  deductionAmount: number;
}): number {
  return Math.max(0, params.baseHonor + params.attendanceBonus + params.positionBonus - params.deductionAmount);
}

export async function listPayrollPeriods(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PAYROLL_ADMIN_ROLES, meta);
  const periods = await prisma.payrollPeriod.findMany({
    where: { schoolId },
    include: {
      slips: {
        select: { netPay: true },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return periods.map((p) => ({
    id: p.id,
    schoolId: p.schoolId,
    month: p.month,
    year: p.year,
    title: p.title,
    ratePerJtm: p.ratePerJtm,
    ratePerHadir: p.ratePerHadir,
    status: p.status,
    notes: p.notes,
    slipCount: p.slips.length,
    totalNetPay: p.slips.reduce((acc, item) => acc + item.netPay, 0),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function createPayrollPeriod(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    month: number;
    year: number;
    title?: string;
    ratePerJtm?: number;
    ratePerHadir?: number;
    notes?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PAYROLL_ADMIN_ROLES, meta);
  const existing = await prisma.payrollPeriod.findUnique({
    where: { schoolId_year_month: { schoolId, year: input.year, month: input.month } },
  });
  if (existing) {
    throw new AppError(409, "PAYROLL_PERIOD_EXISTS", "Periode gaji untuk bulan dan tahun tersebut sudah ada.");
  }

  const title = input.title || `Gaji & Honor ${MONTH_NAMES[input.month]} ${input.year}`;
  const ratePerJtm = input.ratePerJtm ?? 35000;
  const ratePerHadir = input.ratePerHadir ?? 25000;

  const created = await prisma.payrollPeriod.create({
    data: {
      schoolId,
      month: input.month,
      year: input.year,
      title,
      ratePerJtm,
      ratePerHadir,
      notes: input.notes ?? null,
    },
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "PAYROLL_PERIOD_CREATED",
    entityType: "PayrollPeriod",
    entityId: created.id,
    metadata: { month: created.month, year: created.year },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    ...created,
    slipCount: 0,
    totalNetPay: 0,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

type SchoolStaffWithMetrics = Prisma.UserGetPayload<{
  include: {
    assignments: { include: { role: { select: { code: true } } } };
    staffAttendances: { select: { id: true } };
    teachingJournals: { select: { id: true } };
  };
}>;

export async function generatePeriodSlips(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  periodId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PAYROLL_ADMIN_ROLES, meta);
  const period = await prisma.payrollPeriod.findFirst({
    where: { id: periodId, schoolId },
  });
  if (!period) {
    throw new AppError(404, "PAYROLL_PERIOD_NOT_FOUND", "Periode gaji tidak ditemukan.");
  }
  const existingSlips = await prisma.payrollSlip.count({ where: { periodId: period.id, schoolId } });
  if (existingSlips > 0) {
    throw new AppError(409, "PAYROLL_ALREADY_GENERATED", "Slip periode ini sudah dihitung. Generate ulang tidak dijalankan.");
  }

  const startDate = new Date(Date.UTC(period.year, period.month - 1, 1));
  const endDate = new Date(Date.UTC(period.year, period.month, 1));

  const schoolUsers: SchoolStaffWithMetrics[] = await prisma.user.findMany({
    where: {
      isActive: true,
      assignments: { some: { schoolId } },
    },
    include: {
      assignments: { where: { schoolId }, include: { role: { select: { code: true } } } },
      staffAttendances: {
        where: {
          schoolId,
          workDate: { gte: startDate, lt: endDate },
        },
        select: { id: true },
      },
      teachingJournals: {
        where: {
          schoolId,
          journalDate: { gte: startDate, lt: endDate },
        },
        select: { id: true },
      },
    },
  });

  const results = [];
  for (const u of schoolUsers) {
    const roles = u.assignments.map((a) => a.role.code);
    const hasWali = roles.includes("WALI_KELAS");
    const hasWakakur = roles.includes("WAKAKUR");
    const defaultPositionBonus = (hasWali ? 250000 : 0) + (hasWakakur ? 400000 : 0);

    const totalHadirDays = u.staffAttendances.length;
    const totalJtmHours = u.teachingJournals.length;
    const baseHonor = totalJtmHours * period.ratePerJtm;
    const attendanceBonus = totalHadirDays * period.ratePerHadir;

    const existingSlip = await prisma.payrollSlip.findUnique({
      where: { periodId_userId: { periodId: period.id, userId: u.id } },
    });

    const positionBonus = existingSlip ? existingSlip.positionBonus : defaultPositionBonus;
    const deductionAmount = existingSlip ? existingSlip.deductionAmount : 0;
    const netPay = computeNetPay({ baseHonor, attendanceBonus, positionBonus, deductionAmount });

    const slip = await prisma.payrollSlip.upsert({
      where: { periodId_userId: { periodId: period.id, userId: u.id } },
      update: {
        employeeName: u.name,
        roleLabel: roles.join(", "),
        totalHadirDays,
        totalJtmHours,
        baseHonor,
        attendanceBonus,
        netPay,
      },
      create: {
        schoolId,
        periodId: period.id,
        userId: u.id,
        employeeName: u.name,
        roleLabel: roles.join(", "),
        totalHadirDays,
        totalJtmHours,
        baseHonor,
        attendanceBonus,
        positionBonus,
        deductionAmount: 0,
        netPay,
        status: "DRAFT",
      },
    });
    results.push(slip);
  }

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "PAYROLL_SLIPS_GENERATED",
    entityType: "PayrollPeriod",
    entityId: period.id,
    metadata: { generatedCount: results.length },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return results.map((s) => ({
    ...s,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

export async function listPeriodSlips(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  periodId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PAYROLL_ADMIN_ROLES, meta);
  const slips = await prisma.payrollSlip.findMany({
    where: { schoolId, periodId },
    orderBy: { employeeName: "asc" },
  });
  return slips.map((s) => ({
    ...s,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

export async function updatePayrollSlip(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  slipId: string,
  input: {
    positionBonus?: number;
    deductionAmount?: number;
    deductionNote?: string | null;
    status?: "DRAFT" | "DITERBITKAN" | "DIBAYAR";
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, PAYROLL_ADMIN_ROLES, meta);
  const existing = await prisma.payrollSlip.findFirst({
    where: { id: slipId, schoolId },
  });
  if (!existing) {
    throw new AppError(404, "PAYROLL_SLIP_NOT_FOUND", "Slip gaji tidak ditemukan.");
  }

  const positionBonus = input.positionBonus ?? existing.positionBonus;
  const deductionAmount = input.deductionAmount ?? existing.deductionAmount;
  const netPay = computeNetPay({
    baseHonor: existing.baseHonor,
    attendanceBonus: existing.attendanceBonus,
    positionBonus,
    deductionAmount,
  });

  const nextStatus = input.status ?? existing.status;
  const updated = await prisma.payrollSlip.update({
    where: { id: existing.id },
    data: {
      positionBonus,
      deductionAmount,
      deductionNote: input.deductionNote !== undefined ? input.deductionNote : existing.deductionNote,
      netPay,
      status: nextStatus,
      approvedById: nextStatus !== "DRAFT" ? auth.userId : existing.approvedById,
      paidAt: nextStatus === "DIBAYAR" ? existing.paidAt ?? new Date() : existing.paidAt,
    },
  });

  if (nextStatus === "DITERBITKAN") {
    await prisma.payrollPeriod.update({
      where: { id: existing.periodId },
      data: { status: "TERBIT" },
    });
  }

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "PAYROLL_SLIP_UPDATED",
    entityType: "PayrollSlip",
    entityId: updated.id,
    metadata: { status: updated.status, netPay: updated.netPay },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    ...updated,
    paidAt: updated.paidAt ? updated.paidAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function listMyPayrollSlips(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, STAFF_OR_TEACHER_ROLES, meta);
  const slips = await prisma.payrollSlip.findMany({
    where: {
      schoolId,
      userId: auth.userId,
      status: { in: ["DITERBITKAN", "DIBAYAR"] },
    },
    include: {
      period: {
        select: { id: true, month: true, year: true, title: true, status: true },
      },
    },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
  });

  return slips.map((s) => ({
    ...s,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}
