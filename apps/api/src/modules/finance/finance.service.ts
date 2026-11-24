import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../../lib/audit.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { MSG } from "../../lib/messages.ts";
import { assertSchoolAccess, assertSchoolRole, type RequestMeta } from "../../lib/tenant.ts";

const FINANCE_STAFF_ROLES = ["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "TU", "BENDAHARA"] as const;

export async function listBills(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  await assertSchoolAccess(prisma, auth, schoolId, meta);
  const canManageFinance =
    auth.isSystemOwner ||
    auth.assignments.some(
      (a) => a.schoolId === schoolId && FINANCE_STAFF_ROLES.includes(a.roleCode as (typeof FINANCE_STAFF_ROLES)[number]),
    );

  const linkedStudents = await prisma.parentStudentLink.findMany({
    where: { schoolId, parentUserId: auth.userId },
    select: {
      relation: true,
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          nis: true,
          class: { select: { name: true } },
        },
      },
    },
  });

  const linkedStudentIds = linkedStudents.map((l) => l.student.id);
  if (!canManageFinance && linkedStudentIds.length === 0) {
    throw new AppError(403, "TENANT_FORBIDDEN", MSG.tenant);
  }

  const bills = await prisma.studentBill.findMany({
    where: {
      schoolId,
      ...(canManageFinance ? {} : { studentId: { in: linkedStudentIds.length > 0 ? linkedStudentIds : ["__none__"] } }),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          nis: true,
          class: { select: { name: true } },
        },
      },
      payments: {
        orderBy: [{ paidAt: "desc" }],
        take: 10,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 150,
  });

  return {
    canManageFinance,
    linkedChildren: linkedStudents.map((l) => ({
      relation: l.relation,
      ...l.student,
    })),
    bills,
  };
}

export async function createBill(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: {
    studentId: string;
    title: string;
    fundBucket: string;
    amount: number;
    dueDate?: string | null;
  },
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, FINANCE_STAFF_ROLES, meta);

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId },
    select: { id: true, name: true },
  });
  if (!student) {
    throw new AppError(404, "STUDENT_NOT_FOUND", "Siswa tidak ditemukan pada sekolah ini.");
  }

  const bill = await prisma.studentBill.create({
    data: {
      schoolId,
      studentId: student.id,
      title: input.title.trim(),
      fundBucket: input.fundBucket.trim().toUpperCase(),
      amount: input.amount,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nisn: true,
          nis: true,
          class: { select: { name: true } },
        },
      },
      payments: true,
    },
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: auth.userId,
    action: "STUDENT_BILL_CREATED",
    entityType: "StudentBill",
    entityId: bill.id,
    metadata: { studentId: student.id, amount: bill.amount, fundBucket: bill.fundBucket },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { bill };
}

export async function recordBillPayment(
  prisma: PrismaClient,
  auth: AuthState | null,
  schoolId: string,
  billId: string,
  input: {
    amount: number;
    channel: "TUNAI" | "TRANSFER_MANUAL" | "MIDTRANS" | "XENDIT";
    referenceCode?: string | null;
    idempotencyKey?: string;
  },
  meta: RequestMeta,
) {
  if (auth) {
    await assertSchoolRole(prisma, auth, schoolId, FINANCE_STAFF_ROLES, meta);
  }

  if (input.idempotencyKey) {
    const existing = await prisma.studentPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const updatedBill = await prisma.studentBill.findUnique({ where: { id: existing.billId } });
      return { payment: existing, bill: updatedBill, deduplicated: true };
    }
  }

  const bill = await prisma.studentBill.findFirst({
    where: { id: billId, schoolId },
  });
  if (!bill) {
    throw new AppError(404, "BILL_NOT_FOUND", "Tagihan siswa tidak ditemukan.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.studentPayment.create({
      data: {
        schoolId,
        billId: bill.id,
        studentId: bill.studentId,
        amount: input.amount,
        channel: input.channel,
        referenceCode: input.referenceCode ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        recordedById: auth?.userId ?? null,
      },
    });

    const nextPaidAmount = Math.min(bill.amount, bill.paidAmount + input.amount);
    const nextStatus =
      nextPaidAmount >= bill.amount ? "LUNAS" : nextPaidAmount > 0 ? "SEBAGIAN" : "BELUM_LUNAS";

    const updatedBill = await tx.studentBill.update({
      where: { id: bill.id },
      data: {
        paidAmount: nextPaidAmount,
        status: nextStatus,
      },
    });

    return { payment, bill: updatedBill };
  });

  await writeAudit(prisma, {
    schoolId,
    actorId: auth?.userId ?? null,
    action: "STUDENT_PAYMENT_RECORDED",
    entityType: "StudentPayment",
    entityId: result.payment.id,
    metadata: { billId: bill.id, amount: input.amount, channel: input.channel, status: result.bill.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { ...result, deduplicated: false };
}

export async function handlePaymentGatewayWebhook(
  prisma: PrismaClient,
  rawBody: string,
  signatureHeader: string | undefined,
  payload: {
    schoolId: string;
    billId: string;
    amount: number;
    channel: "MIDTRANS" | "XENDIT";
    orderId: string;
    transactionStatus: string;
  },
  meta: RequestMeta,
) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Signature webhook payment gateway tidak valid.");
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!signatureHeader || signatureHeader !== expected) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Signature webhook payment gateway tidak valid.");
  }

  const normalized = payload.transactionStatus.toUpperCase();
  if (!["SETTLEMENT", "CAPTURE", "PAID", "SUCCEEDED"].includes(normalized)) {
    return { ignored: true, status: normalized };
  }

  return recordBillPayment(
    prisma,
    null,
    payload.schoolId,
    payload.billId,
    {
      amount: payload.amount,
      channel: payload.channel,
      referenceCode: payload.orderId,
      idempotencyKey: `gw-${payload.channel.toLowerCase()}-${payload.orderId}`,
    },
    meta,
  );
}

export async function listParentLinks(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, FINANCE_STAFF_ROLES, meta);
  const links = await prisma.parentStudentLink.findMany({
    where: { schoolId },
    include: {
      parentUser: { select: { id: true, name: true, email: true } },
      student: { select: { id: true, name: true, nisn: true, class: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  return { links };
}

export async function createParentLink(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: { parentUserId: string; studentId: string; relation: string },
  meta: RequestMeta,
) {
  await assertSchoolRole(prisma, auth, schoolId, FINANCE_STAFF_ROLES, meta);
  const link = await prisma.parentStudentLink.upsert({
    where: {
      parentUserId_studentId: {
        parentUserId: input.parentUserId,
        studentId: input.studentId,
      },
    },
    update: { relation: input.relation.trim() },
    create: {
      schoolId,
      parentUserId: input.parentUserId,
      studentId: input.studentId,
      relation: input.relation.trim(),
    },
  });
  return { link };
}
