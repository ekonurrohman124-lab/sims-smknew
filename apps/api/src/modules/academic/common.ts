import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import { writeAudit } from "../../lib/audit.ts";
import { AppError } from "../../lib/errors.ts";
import { MSG } from "../../lib/messages.ts";
import type { RequestMeta } from "../../lib/tenant.ts";

export type PageQuery = {
  q?: string;
  page: number;
  pageSize: 10 | 25 | 50;
  classId?: string;
  concentrationId?: string;
};

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function emptyPage<T>(query: PageQuery) {
  return { items: [] as T[], page: query.page, pageSize: query.pageSize, total: 0 };
}

export function pageWindow(query: PageQuery) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function duplicate(message: string): never {
  throw new AppError(409, "DUPLICATE", message);
}

export function notFound(): never {
  throw new AppError(404, "NOT_FOUND", MSG.notFound);
}

export function inUse(message = "Data masih digunakan dan tidak dapat dihapus."): never {
  throw new AppError(409, "IN_USE", message);
}

export function invalidReference(message: string): never {
  throw new AppError(400, "INVALID_REFERENCE", message);
}

export function rethrowKnown(error: unknown, duplicateMessage: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    duplicate(duplicateMessage);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014")) {
    inUse();
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    notFound();
  }
  throw error;
}

export async function ownedRow<T>(query: Promise<T | null>, message: string): Promise<T> {
  const row = await query;
  if (!row) invalidReference(message);
  return row;
}

export async function auditChange(
  prisma: PrismaClient,
  auth: AuthState,
  meta: RequestMeta,
  input: { schoolId: string; action: string; entityType: string; entityId?: string | null },
) {
  await writeAudit(prisma, {
    schoolId: input.schoolId,
    actorId: auth.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export function contains(q: string | undefined) {
  if (!q) return undefined;
  return { contains: q, mode: "insensitive" as const };
}
