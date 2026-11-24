import type { TeacherAccountResult } from "@sims/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import { AppError } from "../../lib/errors.ts";
import { generateTemporaryPassword, hashPassword } from "../../lib/password.ts";
import type { RequestMeta } from "../../lib/tenant.ts";
import { grantAssignment } from "../access/assignments.ts";
import { writeAudit } from "../../lib/audit.ts";
import { auditChange, duplicate } from "./common.ts";
import { assertUniqueNip, findTeacherDto } from "./people.service.ts";

const TEACHER_ROLES = new Set(["GURU_MAPEL", "WALI_KELAS"]);

function teacherEmail(value: string | null): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new AppError(400, "VALIDATION_ERROR", "Isi email guru yang valid. Email dipakai untuk masuk.");
  }
  return email;
}

function unchanged(message: string): never {
  throw new AppError(409, "ACCOUNT_UNCHANGED", message);
}

async function loadUser(prisma: PrismaClient, email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      teacher: { select: { id: true, schoolId: true } },
      assignments: {
        where: { isActive: true },
        include: { role: { select: { code: true } } },
      },
    },
  });
}

export async function provisionTeacherAccount(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  teacherId: string,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const teacher = await findTeacherDto(prisma, schoolId, teacherId);
  if (teacher.userId) {
    duplicate("Guru ini sudah memiliki akun.");
  }

  const email = teacherEmail(teacher.email);
  const existing = await loadUser(prisma, email);
  if (!existing) {
    const temporaryPassword = generateTemporaryPassword();
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: teacher.name,
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          isActive: true,
        },
      });
      await grantAssignment(tx, { userId: user.id, roleCode: "GURU_MAPEL", schoolId });
      await tx.teacher.update({ where: { id: teacher.id }, data: { userId: user.id } });
    });
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: "TEACHER_ACCOUNT_CREATED",
      entityType: "Teacher",
      entityId: teacher.id,
    });
    return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: true, temporaryPassword };
  }

  if (existing.assignments.some((assignment) => assignment.role.code === "SYSTEM_OWNER")) {
    unchanged("Akun pemilik sistem tidak diubah.");
  }
  if (!existing.isActive) {
    unchanged("Akun dengan email ini nonaktif dan tidak diubah.");
  }
  if (existing.teacher && existing.teacher.id !== teacher.id) {
    duplicate(
      existing.teacher.schoolId === schoolId
        ? "Akun ini sudah tertaut ke data guru. Guru yang sama dapat merangkap guru mapel dan wali kelas."
        : "Akun ini sudah tertaut ke guru di sekolah lain.",
    );
  }

  const schoolIds = new Set(existing.assignments.map((assignment) => assignment.schoolId).filter((id): id is string => Boolean(id)));
  if (schoolIds.size > 0 && !schoolIds.has(schoolId)) {
    unchanged("Email ini sudah dipakai akun sekolah lain. Akun tersebut tidak diubah.");
  }

  await prisma.$transaction(async (tx) => {
    await grantAssignment(tx, { userId: existing.id, roleCode: "GURU_MAPEL", schoolId });
    await tx.teacher.update({ where: { id: teacher.id }, data: { userId: existing.id } });
  });
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: "TEACHER_ACCOUNT_LINKED",
    entityType: "Teacher",
    entityId: teacher.id,
  });
  return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: false, temporaryPassword: null };
}

export async function unlinkTeacherAccount(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  teacherId: string,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const teacher = await findTeacherDto(prisma, schoolId, teacherId);
  if (!teacher.userId) {
    throw new AppError(400, "VALIDATION_ERROR", "Guru ini belum tertaut ke akun.");
  }

  const linkedUserId = teacher.userId;
  const linked = await prisma.user.findUnique({
    where: { id: linkedUserId },
    select: { id: true, email: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.teacher.update({ where: { id: teacher.id }, data: { userId: null } });
    await writeAudit(tx, {
      schoolId,
      actorId: auth.userId,
      action: "TEACHER_ACCOUNT_UNLINKED",
      entityType: "Teacher",
      entityId: teacher.id,
      metadata: {
        previousUserId: linkedUserId,
        previousUserEmail: linked?.email ?? null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: false, temporaryPassword: null };
}

export async function resetTeacherPassword(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  teacherId: string,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const teacher = await findTeacherDto(prisma, schoolId, teacherId);
  if (!teacher.userId) {
    throw new AppError(400, "VALIDATION_ERROR", "Guru belum memiliki akun.");
  }

  const user = await prisma.user.findUnique({
    where: { id: teacher.userId },
    include: {
      assignments: {
        where: { isActive: true },
        include: { role: { select: { code: true } } },
      },
    },
  });
  if (!user) {
    throw new AppError(400, "VALIDATION_ERROR", "Guru belum memiliki akun.");
  }
  if (
    user.assignments.some((assignment) => assignment.role.code === "SYSTEM_OWNER" || assignment.role.code === "ADMIN_SEKOLAH")
  ) {
    unchanged("Akun pemilik sistem atau admin sekolah tidak direset dari data guru.");
  }
  if (user.assignments.some((assignment) => assignment.schoolId && assignment.schoolId !== schoolId)) {
    unchanged("Akun ini juga dipakai di sekolah lain. Kata sandi tidak diubah.");
  }
  if (user.assignments.some((assignment) => !TEACHER_ROLES.has(assignment.role.code))) {
    unchanged("Akun ini memiliki peran lain. Kata sandi tidak diubah.");
  }

  const temporaryPassword = generateTemporaryPassword();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: "TEACHER_PASSWORD_RESET",
    entityType: "Teacher",
    entityId: teacher.id,
  });
  return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: false, temporaryPassword };
}

type TeacherAccountRole = "GURU_MAPEL" | "WALI_KELAS";

type TeacherAccountInput = {
  nip: string | null;
  nuptk: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  email: string;
  phone: string | null;
  isActive: boolean;
  roles: TeacherAccountRole[];
  linkExisting?: boolean;
};

function uniqueRoles(roles: readonly TeacherAccountRole[]): TeacherAccountRole[] {
  return [...new Set(roles)];
}

async function assertWaliCanBeRemoved(prisma: PrismaClient, schoolId: string, teacherId: string, roles: readonly TeacherAccountRole[]) {
  if (roles.includes("WALI_KELAS")) return;
  const active = await prisma.homeroomAssignment.findFirst({
    where: { schoolId, teacherId, academicPeriod: { isActive: true } },
    select: { id: true },
  });
  if (active) {
    throw new AppError(409, "CONFLICT", "Peran wali kelas tidak dicabut selama penugasan wali kelas pada semester aktif masih ada.");
  }
}

async function syncTeacherRoles(
  prisma: Prisma.TransactionClient,
  userId: string,
  schoolId: string,
  roles: readonly TeacherAccountRole[],
) {
  const remove = (["GURU_MAPEL", "WALI_KELAS"] as const).filter((role) => !roles.includes(role));
  if (remove.length > 0) {
    await prisma.userRole.updateMany({
      where: { userId, schoolId, isActive: true, role: { code: { in: [...remove] } } },
      data: { isActive: false },
    });
  }
  for (const roleCode of roles) {
    await grantAssignment(prisma, { userId, roleCode, schoolId });
  }
}

function assertCanLink(
  existing: NonNullable<Awaited<ReturnType<typeof loadUser>>>,
  schoolId: string,
) {
  if (existing.assignments.some((assignment) => assignment.role.code === "SYSTEM_OWNER")) {
    unchanged("Akun pemilik sistem tidak dihubungkan dari data guru.");
  }
  if (!existing.isActive) {
    unchanged("Akun dengan email ini nonaktif dan tidak dihubungkan.");
  }
  if (existing.teacher) {
    duplicate(
      existing.teacher.schoolId === schoolId
        ? "Akun ini sudah tertaut ke data guru. Gunakan data guru tersebut."
        : "Akun ini sudah tertaut ke guru di sekolah lain.",
    );
  }
  const schoolIds = new Set(existing.assignments.map((assignment) => assignment.schoolId).filter((id): id is string => Boolean(id)));
  if (schoolIds.size > 0 && !schoolIds.has(schoolId)) {
    unchanged("Email ini sudah dipakai akun sekolah lain. Akun tersebut tidak diubah.");
  }
}

export async function createTeacherWithAccount(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: TeacherAccountInput,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const roles = uniqueRoles(input.roles);
  const email = teacherEmail(input.email);
  await assertUniqueNip(prisma, schoolId, input.nip);
  const existing = await loadUser(prisma, email);
  if (existing && !input.linkExisting) {
    assertCanLink(existing, schoolId);
    throw new AppError(409, "ACCOUNT_EXISTS", "Email ini sudah terdaftar. Hubungkan akun yang sudah ada hanya jika Anda mengonfirmasinya.", {
      linkAvailable: true,
    });
  }

  if (existing) {
    assertCanLink(existing, schoolId);
    const teacher = await prisma.$transaction(async (tx) => {
      const row = await tx.teacher.create({
        data: {
          schoolId,
          name: input.name,
          nip: input.nip,
          nuptk: input.nuptk,
          gender: input.gender,
          email,
          phone: input.phone,
          isActive: input.isActive,
          userId: existing.id,
        },
      });
      await syncTeacherRoles(tx, existing.id, schoolId, roles);
      return row;
    });
    await auditChange(prisma, auth, meta, {
      schoolId,
      action: "TEACHER_ACCOUNT_LINKED",
      entityType: "Teacher",
      entityId: teacher.id,
    });
    return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: false, temporaryPassword: null };
  }

  const temporaryPassword = generateTemporaryPassword();
  const teacher = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        isActive: input.isActive,
      },
    });
    const row = await tx.teacher.create({
      data: {
        schoolId,
        name: input.name,
        nip: input.nip,
        nuptk: input.nuptk,
        gender: input.gender,
        email,
        phone: input.phone,
        isActive: input.isActive,
        userId: user.id,
      },
    });
    await syncTeacherRoles(tx, user.id, schoolId, roles);
    return row;
  });
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: "TEACHER_WITH_ACCOUNT_CREATED",
    entityType: "Teacher",
    entityId: teacher.id,
  });
  return { item: await findTeacherDto(prisma, schoolId, teacher.id), created: true, temporaryPassword };
}

export async function reviseTeacherProfile(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  teacherId: string,
  input: Omit<TeacherAccountInput, "linkExisting">,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const current = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId },
    select: { id: true, userId: true },
  });
  if (!current) throw new AppError(404, "NOT_FOUND", "Guru tidak ditemukan.");
  const roles = uniqueRoles(input.roles);
  const email = teacherEmail(input.email);
  await assertUniqueNip(prisma, schoolId, input.nip, current.id);
  if (current.userId) {
    const user = await prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, email: true } });
    if (user && user.email !== email) {
      throw new AppError(409, "ACCOUNT_UNCHANGED", "Email akun yang sudah terhubung tidak diubah dari formulir ini.");
    }
    await assertWaliCanBeRemoved(prisma, schoolId, current.id, roles);
  }

  await prisma.$transaction(async (tx) => {
    await tx.teacher.update({
      where: { id: current.id },
      data: {
        name: input.name,
        nip: input.nip,
        nuptk: input.nuptk,
        gender: input.gender,
        email,
        phone: input.phone,
        isActive: input.isActive,
        userId: current.userId,
      },
    });
    if (current.userId) {
      await tx.user.update({ where: { id: current.userId }, data: { isActive: input.isActive } });
      await syncTeacherRoles(tx, current.userId, schoolId, roles);
    }
  });
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: "TEACHER_UPDATED",
    entityType: "Teacher",
    entityId: current.id,
  });
  return { item: await findTeacherDto(prisma, schoolId, current.id), created: false, temporaryPassword: null };
}

type LinkTeacherProfileInput = {
  userId: string;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  nip: string | null;
  nuptk: string | null;
  phone: string | null;
};

function uniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}

export async function linkTeacherProfile(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: LinkTeacherProfileInput,
  meta: RequestMeta,
): Promise<TeacherAccountResult> {
  const user = await prisma.user.findFirst({
    where: {
      id: input.userId,
      isActive: true,
      assignments: { some: { schoolId, isActive: true, role: { code: { in: ["GURU_MAPEL", "WALI_KELAS"] } } } },
      NOT: { assignments: { some: { isActive: true, role: { code: "SYSTEM_OWNER" } } } },
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      teacher: { select: { id: true, schoolId: true } },
      assignments: { where: { isActive: true }, select: { id: true, schoolId: true, role: { select: { code: true } } } },
    },
  });
  if (!user) throw new AppError(404, "NOT_FOUND", "Akun guru sekolah ini tidak ditemukan.");
  if (user.teacher) {
    if (user.teacher.schoolId !== schoolId) duplicate("Akun ini sudah tertaut ke guru di sekolah lain.");
    return { item: await findTeacherDto(prisma, schoolId, user.teacher.id), created: false, temporaryPassword: null };
  }

  await assertUniqueNip(prisma, schoolId, input.nip);
  const beforeRoles = user.assignments.map((item) => `${item.id}:${item.schoolId}:${item.role.code}`).join("|");
  let teacherId: string;
  try {
    const created = await prisma.teacher.create({
      data: {
        schoolId,
        userId: user.id,
        name: input.name.trim(),
        gender: input.gender,
        email: user.email,
        nip: input.nip,
        nuptk: input.nuptk,
        phone: input.phone,
        isActive: true,
      },
      select: { id: true },
    });
    teacherId = created.id;
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const existing = await prisma.teacher.findFirst({ where: { userId: user.id }, select: { id: true, schoolId: true } });
    if (existing?.schoolId === schoolId) {
      return { item: await findTeacherDto(prisma, schoolId, existing.id), created: false, temporaryPassword: null };
    }
    duplicate(existing ? "Akun ini sudah tertaut ke guru di sekolah lain." : "NIP sudah digunakan di sekolah ini.");
  }

  const after = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      email: true,
      passwordHash: true,
      assignments: { where: { isActive: true }, select: { id: true, schoolId: true, role: { select: { code: true } } } },
    },
  });
  const afterRoles = after.assignments.map((item) => `${item.id}:${item.schoolId}:${item.role.code}`).join("|");
  if (after.email !== user.email || after.passwordHash !== user.passwordHash || afterRoles !== beforeRoles) {
    throw new AppError(409, "ACCOUNT_UNCHANGED", "Akun guru tidak boleh berubah saat profil dihubungkan.");
  }
  await auditChange(prisma, auth, meta, {
    schoolId,
    action: "TEACHER_ACCOUNT_LINKED",
    entityType: "Teacher",
    entityId: teacherId,
  });
  return { item: await findTeacherDto(prisma, schoolId, teacherId), created: true, temporaryPassword: null };
}
