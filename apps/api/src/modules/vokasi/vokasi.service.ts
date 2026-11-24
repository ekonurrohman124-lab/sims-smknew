import type { PrismaClient } from "@prisma/client";
import type { RoleCode } from "@sims/shared";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const VOKASI_READ_ROLES: RoleCode[] = [
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
  "GURU_MAPEL",
  "WALI_KELAS",
  "KAPROG",
  "WAKA_SARPRAS",
  "WAKA_HUMAS",
  "WAKA_KESISWAAN",
];

const INVENTORY_WRITE_ROLES: RoleCode[] = [
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "KAPROG",
  "WAKA_SARPRAS",
];

const TOOL_LOAN_ROLES: RoleCode[] = [
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "KAPROG",
  "WAKA_SARPRAS",
  "GURU_MAPEL",
  "WALI_KELAS",
];

const BKK_WRITE_ROLES: RoleCode[] = [
  "ADMIN_SEKOLAH",
  "TU",
  "KEPALA_SEKOLAH",
  "WAKAKUR",
  "WAKA_HUMAS",
  "KAPROG",
];

export async function listWorkshopTools(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, VOKASI_READ_ROLES, meta);
  const tools = await prisma.workshopTool.findMany({
    where: { schoolId },
    orderBy: [{ labName: "asc" }, { name: "asc" }],
  });
  return tools.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function createWorkshopTool(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    assetCode: string;
    name: string;
    labName: string;
    totalQty?: number;
    condition?: "BAIK" | "PERLU_PERBAIKAN" | "RUSAK";
    notes?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, INVENTORY_WRITE_ROLES, meta);
  const exists = await prisma.workshopTool.findUnique({
    where: { schoolId_assetCode: { schoolId, assetCode: input.assetCode } },
  });
  if (exists) {
    throw new AppError(409, "TOOL_ASSET_CODE_EXISTS", "Kode aset/barcode alat tersebut sudah terdaftar.");
  }
  const qty = input.totalQty ?? 1;
  const created = await prisma.workshopTool.create({
    data: {
      schoolId,
      assetCode: input.assetCode,
      name: input.name,
      labName: input.labName,
      totalQty: qty,
      availableQty: qty,
      condition: input.condition ?? "BAIK",
      notes: input.notes ?? null,
    },
  });
  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "WORKSHOP_TOOL_CREATED",
    entityType: "WorkshopTool",
    entityId: created.id,
    metadata: { assetCode: created.assetCode, name: created.name },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function listToolLoans(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, VOKASI_READ_ROLES, meta);
  const loans = await prisma.toolLoan.findMany({
    where: { schoolId },
    include: {
      tool: { select: { id: true, assetCode: true, name: true, labName: true } },
    },
    orderBy: { borrowedAt: "desc" },
  });
  return loans.map((l) => ({
    id: l.id,
    schoolId: l.schoolId,
    toolId: l.toolId,
    borrowerName: l.borrowerName,
    borrowerRole: l.borrowerRole,
    qty: l.qty,
    purpose: l.purpose,
    borrowedAt: l.borrowedAt.toISOString(),
    returnedAt: l.returnedAt ? l.returnedAt.toISOString() : null,
    status: l.status,
    tool: l.tool,
  }));
}

export async function createToolLoan(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    toolId: string;
    borrowerName: string;
    borrowerRole: string;
    qty?: number;
    purpose?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, TOOL_LOAN_ROLES, meta);
  const qty = input.qty ?? 1;

  const loan = await prisma.$transaction(async (tx) => {
    const tool = await tx.workshopTool.findFirst({
      where: { id: input.toolId, schoolId },
    });
    if (!tool) {
      throw new AppError(404, "TOOL_NOT_FOUND", "Alat praktik tidak ditemukan.");
    }
    if (tool.availableQty < qty) {
      throw new AppError(400, "INSUFFICIENT_TOOL_STOCK", `Stok alat tersedia hanya ${tool.availableQty} unit.`);
    }

    await tx.workshopTool.update({
      where: { id: tool.id },
      data: { availableQty: { decrement: qty } },
    });

    return tx.toolLoan.create({
      data: {
        schoolId,
        toolId: tool.id,
        borrowerName: input.borrowerName,
        borrowerRole: input.borrowerRole,
        qty,
        purpose: input.purpose ?? null,
        status: "DIPINJAM",
      },
      include: {
        tool: { select: { id: true, assetCode: true, name: true, labName: true } },
      },
    });
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "TOOL_LOAN_CREATED",
    entityType: "ToolLoan",
    entityId: loan.id,
    metadata: { borrowerName: loan.borrowerName, qty: loan.qty },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    id: loan.id,
    schoolId: loan.schoolId,
    toolId: loan.toolId,
    borrowerName: loan.borrowerName,
    borrowerRole: loan.borrowerRole,
    qty: loan.qty,
    purpose: loan.purpose,
    borrowedAt: loan.borrowedAt.toISOString(),
    returnedAt: null,
    status: loan.status,
    tool: loan.tool,
  };
}

export async function returnToolLoan(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  loanId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, INVENTORY_WRITE_ROLES, meta);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.toolLoan.findFirst({
      where: { id: loanId, schoolId },
    });
    if (!existing) {
      throw new AppError(404, "TOOL_LOAN_NOT_FOUND", "Data peminjaman tidak ditemukan.");
    }
    if (existing.status === "DIKEMBALIKAN") {
      throw new AppError(400, "TOOL_ALREADY_RETURNED", "Alat ini sudah dikembalikan sebelumnya.");
    }

    await tx.workshopTool.update({
      where: { id: existing.toolId },
      data: { availableQty: { increment: existing.qty } },
    });

    return tx.toolLoan.update({
      where: { id: existing.id },
      data: { status: "DIKEMBALIKAN", returnedAt: new Date() },
      include: {
        tool: { select: { id: true, assetCode: true, name: true, labName: true } },
      },
    });
  });

  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "TOOL_LOAN_RETURNED",
    entityType: "ToolLoan",
    entityId: updated.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    id: updated.id,
    schoolId: updated.schoolId,
    toolId: updated.toolId,
    borrowerName: updated.borrowerName,
    borrowerRole: updated.borrowerRole,
    qty: updated.qty,
    purpose: updated.purpose,
    borrowedAt: updated.borrowedAt.toISOString(),
    returnedAt: updated.returnedAt ? updated.returnedAt.toISOString() : null,
    status: updated.status,
    tool: updated.tool,
  };
}

export async function listBkkJobs(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, VOKASI_READ_ROLES, meta);
  const jobs = await prisma.bkkJobPost.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
  return jobs.map((j) => ({
    ...j,
    deadline: j.deadline ? j.deadline.toISOString().slice(0, 10) : null,
    createdAt: j.createdAt.toISOString(),
  }));
}

export async function createBkkJob(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    companyName: string;
    positionTitle: string;
    location: string;
    majorTarget?: string;
    deadline?: string;
    description: string;
    contactInfo?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, BKK_WRITE_ROLES, meta);
  const created = await prisma.bkkJobPost.create({
    data: {
      schoolId,
      companyName: input.companyName,
      positionTitle: input.positionTitle,
      location: input.location,
      majorTarget: input.majorTarget ?? null,
      deadline: input.deadline ? new Date(`${input.deadline}T00:00:00.000Z`) : null,
      description: input.description,
      contactInfo: input.contactInfo ?? null,
    },
  });
  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "BKK_JOB_CREATED",
    entityType: "BkkJobPost",
    entityId: created.id,
    metadata: { companyName: created.companyName, positionTitle: created.positionTitle },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return {
    ...created,
    deadline: created.deadline ? created.deadline.toISOString().slice(0, 10) : null,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function listAlumniTracers(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, VOKASI_READ_ROLES, meta);
  const items = await prisma.alumniTracer.findMany({
    where: { schoolId },
    orderBy: [{ graduationYear: "desc" }, { alumniName: "asc" }],
  });
  return items.map((item) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
  }));
}

export async function createAlumniTracer(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    studentId?: string;
    alumniName: string;
    graduationYear: number;
    majorName: string;
    status: "BEKERJA" | "WIRAUSAHA" | "KULIAH" | "BELUM_BEKERJA";
    institutionName?: string;
    positionOrStudy?: string;
    phone?: string;
  },
  meta: RequestMeta
) {
  await assertSchoolRole(prisma, auth, schoolId, BKK_WRITE_ROLES, meta);
  if (input.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, schoolId },
      select: { id: true },
    });
    if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Siswa tidak ditemukan pada sekolah ini.");
    const existing = await prisma.alumniTracer.findFirst({
      where: { schoolId, studentId: student.id, graduationYear: input.graduationYear },
      select: { id: true },
    });
    if (existing) throw new AppError(409, "ALUMNI_TRACER_EXISTS", "Tracer kelulusan siswa ini sudah ada.");
  }
  const created = await prisma.alumniTracer.create({
    data: {
      schoolId,
      studentId: input.studentId ?? null,
      alumniName: input.alumniName,
      graduationYear: input.graduationYear,
      majorName: input.majorName,
      status: input.status,
      institutionName: input.institutionName ?? null,
      positionOrStudy: input.positionOrStudy ?? null,
      phone: input.phone ?? null,
    },
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new AppError(409, "ALUMNI_TRACER_EXISTS", "Tracer kelulusan siswa ini sudah ada.");
    }
    throw error;
  });
  await writeAudit(prisma, {
    actorId: auth.userId,
    schoolId,
    action: "ALUMNI_TRACER_CREATED",
    entityType: "AlumniTracer",
    entityId: created.id,
    metadata: { alumniName: created.alumniName, status: created.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
  };
}
