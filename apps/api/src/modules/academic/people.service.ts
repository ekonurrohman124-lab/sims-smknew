import type { PageResult, StudentDto, TeacherDto, TeacherRosterDto } from "@sims/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthState } from "../../lib/auth-state.ts";
import { writeAudit } from "../../lib/audit.ts";
import { AppError } from "../../lib/errors.ts";
import type { RequestMeta } from "../../lib/tenant.ts";
import {
  auditChange,
  duplicate,
  emptyPage,
  inUse,
  ownedRow,
  pageWindow,
  parseDateOnly,
  rethrowKnown,
  toDateOnly,
  type PageQuery,
} from "./common.ts";
import type { DataScope } from "./scope.ts";

type TeacherInput = {
  nip: string | null;
  nuptk: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  email: string | null;
  phone: string | null;
  userId: string | null;
  isActive: boolean;
};

type StudentInput = {
  nisn: string;
  nis: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  birthPlace: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  classId: string | null;
  concentrationId: string | null;
  isActive: boolean;
};

function textSearch(q: string | undefined) {
  return q ? { contains: q, mode: "insensitive" as const } : undefined;
}

async function assertMember(prisma: PrismaClient, schoolId: string, userId: string | null, exceptTeacherId?: string) {
  if (!userId) return;
  const member = await prisma.userRole.findFirst({
    where: { schoolId, userId, isActive: true },
    select: { id: true },
  });
  if (!member) {
    throw new AppError(400, "INVALID_REFERENCE", "Akun pengguna tidak terdaftar di sekolah ini.");
  }
  const linked = await prisma.teacher.findFirst({
    where: { userId, ...(exceptTeacherId ? { id: { not: exceptTeacherId } } : {}) },
    select: { schoolId: true },
  });
  if (!linked) return;
  duplicate(
    linked.schoolId === schoolId
      ? "Akun ini sudah tertaut ke data guru. Guru yang sama dapat merangkap guru mapel dan wali kelas."
      : "Akun ini sudah tertaut ke guru di sekolah lain.",
  );
}

const TEACHER_ROLE_CODES = new Set(["GURU_MAPEL", "WALI_KELAS"]);

export function teacherUserInclude(schoolId: string) {
  return {
    user: {
      select: {
        name: true,
        email: true,
        assignments: {
          where: { isActive: true, schoolId },
          select: { role: { select: { code: true } } },
        },
      },
    },
  } satisfies Prisma.TeacherInclude;
}

function toTeacher(row: {
  id: string;
  schoolId: string;
  userId: string | null;
  nip: string | null;
  nuptk: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  email: string | null;
  phone: string | null;
  isActive: boolean;
  user: { name: string; email: string; assignments: Array<{ role: { code: string } }> } | null;
}): TeacherDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    userId: row.userId,
    userName: row.user?.name ?? null,
    loginEmail: row.user?.email ?? null,
    roleCodes: (row.user?.assignments ?? [])
      .map((assignment) => assignment.role.code)
      .filter((code): code is "GURU_MAPEL" | "WALI_KELAS" => TEACHER_ROLE_CODES.has(code)),
    nip: row.nip,
    nuptk: row.nuptk,
    name: row.name,
    gender: row.gender,
    email: row.email,
    phone: row.phone,
    isActive: row.isActive,
  };
}

export async function findTeacherDto(prisma: PrismaClient, schoolId: string, id: string): Promise<TeacherDto> {
  const row = await ownedRow(
    prisma.teacher.findFirst({
      where: { id, schoolId },
      include: teacherUserInclude(schoolId),
    }),
    "Guru tidak ditemukan.",
  );
  return toTeacher(row);
}

const TEACHING_ROLE_LIST = ["GURU_MAPEL", "WALI_KELAS"] as const;

function rosterFromTeacher(row: Parameters<typeof toTeacher>[0]): TeacherRosterDto {
  return { ...toTeacher(row), linkStatus: row.userId ? "TERHUBUNG" : null };
}

function rosterFromAccount(schoolId: string, user: {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  assignments: Array<{ role: { code: string } }>;
}): TeacherRosterDto {
  return {
    id: user.id,
    schoolId,
    userId: user.id,
    userName: user.name,
    loginEmail: user.email,
    roleCodes: user.assignments
      .map((assignment) => assignment.role.code)
      .filter((code): code is "GURU_MAPEL" | "WALI_KELAS" => TEACHER_ROLE_CODES.has(code)),
    nip: null,
    nuptk: null,
    name: user.name,
    gender: null,
    email: user.email,
    phone: null,
    isActive: user.isActive,
    linkStatus: "BELUM_TERHUBUNG",
  };
}

export async function listTeachers(
  prisma: PrismaClient,
  schoolId: string,
  scope: DataScope,
  query: PageQuery,
): Promise<PageResult<TeacherRosterDto>> {
  if (scope.kind === "assigned" && !scope.teacherId) return emptyPage<TeacherRosterDto>(query);
  const search = textSearch(query.q);
  const where: Prisma.TeacherWhereInput = {
    schoolId,
    ...(scope.kind === "assigned" && scope.teacherId ? { id: scope.teacherId } : {}),
    ...(search
      ? { OR: [{ name: search }, { nip: search }, { nuptk: search }, { email: search }, { user: { is: { email: search } } }] }
      : {}),
  };
  if (scope.kind === "assigned") {
    const [rows, total] = await Promise.all([
      prisma.teacher.findMany({
        where,
        include: teacherUserInclude(schoolId),
        orderBy: { name: "asc" },
        ...pageWindow(query),
      }),
      prisma.teacher.count({ where }),
    ]);
    return { items: rows.map(rosterFromTeacher), total, page: query.page, pageSize: query.pageSize };
  }

  const [profiles, accounts] = await Promise.all([
    prisma.teacher.findMany({
      where,
      include: teacherUserInclude(schoolId),
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        teacher: { is: null },
        assignments: {
          some: { schoolId, isActive: true, role: { code: { in: [...TEACHING_ROLE_LIST] } } },
        },
        NOT: { assignments: { some: { isActive: true, role: { code: "SYSTEM_OWNER" } } } },
        ...(search ? { OR: [{ name: search }, { email: search }] } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        assignments: {
          where: { schoolId, isActive: true, role: { code: { in: [...TEACHING_ROLE_LIST] } } },
          select: { role: { select: { code: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const items = [...profiles.map(rosterFromTeacher), ...accounts.map((account) => rosterFromAccount(schoolId, account))]
    .sort((left, right) => left.name.localeCompare(right.name, "id") || left.id.localeCompare(right.id));
  const start = (query.page - 1) * query.pageSize;
  return { items: items.slice(start, start + query.pageSize), total: items.length, page: query.page, pageSize: query.pageSize };
}

export async function assertUniqueNip(prisma: PrismaClient, schoolId: string, nip: string | null, exceptId?: string) {
  if (!nip) return;
  const existing = await prisma.teacher.findFirst({
    where: { schoolId, nip, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) duplicate("NIP sudah digunakan di sekolah ini.");
}

export async function createTeacher(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: TeacherInput,
  meta: RequestMeta,
) {
  await assertUniqueNip(prisma, schoolId, input.nip);
  await assertMember(prisma, schoolId, input.userId);
  try {
    const row = await prisma.teacher.create({
      data: { schoolId, ...input },
      include: teacherUserInclude(schoolId),
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "TEACHER_CREATED", entityType: "Teacher", entityId: row.id });
    return toTeacher(row);
  } catch (error) {
    rethrowKnown(error, "NIP sudah digunakan, atau akun ini sudah tertaut ke guru. Gunakan data guru yang sama untuk merangkap mapel dan wali kelas.");
  }
}

export async function updateTeacher(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: TeacherInput,
  meta: RequestMeta,
) {
  const current = await ownedRow(
    prisma.teacher.findFirst({ where: { id, schoolId }, select: { id: true, userId: true } }),
    "Guru tidak ditemukan.",
  );
  await assertUniqueNip(prisma, schoolId, input.nip, id);
  await assertMember(prisma, schoolId, current.userId, id);
  try {
    const row = await prisma.teacher.update({
      where: { id },
      data: { ...input, userId: current.userId },
      include: teacherUserInclude(schoolId),
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "TEACHER_UPDATED", entityType: "Teacher", entityId: id });
    return toTeacher(row);
  } catch (error) {
    rethrowKnown(error, "NIP sudah digunakan, atau akun ini sudah tertaut ke guru. Gunakan data guru yang sama untuk merangkap mapel dan wali kelas.");
  }
}

export async function deleteTeacher(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.teacher.findFirst({ where: { id, schoolId }, select: { id: true } }), "Guru tidak ditemukan.");
  const [teachings, homerooms] = await Promise.all([
    prisma.teachingAssignment.count({ where: { teacherId: id } }),
    prisma.homeroomAssignment.count({ where: { teacherId: id } }),
  ]);
  if (teachings + homerooms > 0) inUse("Guru masih memiliki penugasan mengajar atau wali kelas.");
  await prisma.teacher.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "TEACHER_DELETED", entityType: "Teacher", entityId: id });
}

function toStudent(row: {
  id: string;
  schoolId: string;
  nisn: string;
  nis: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  birthPlace: string | null;
  birthDate: Date | null;
  email: string | null;
  phone: string | null;
  classId: string | null;
  concentrationId: string | null;
  isActive: boolean;
  class: { name: string } | null;
  concentration: { name: string } | null;
}): StudentDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    nisn: row.nisn,
    nis: row.nis,
    name: row.name,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate ? toDateOnly(row.birthDate) : null,
    email: row.email,
    phone: row.phone,
    classId: row.classId,
    className: row.class?.name ?? null,
    concentrationId: row.concentrationId,
    concentrationName: row.concentration?.name ?? null,
    isActive: row.isActive,
  };
}

export async function listStudents(
  prisma: PrismaClient,
  schoolId: string,
  scope: DataScope,
  query: PageQuery,
): Promise<PageResult<StudentDto>> {
  if (scope.kind === "assigned" && scope.classIds.length === 0) return emptyPage(query);
  if (query.classId && scope.kind === "assigned" && !scope.classIds.includes(query.classId)) return emptyPage(query);
  if (query.concentrationId) {
    const concentration = await prisma.expertiseConcentration.findFirst({
      where: { id: query.concentrationId, schoolId, isActive: true },
      select: { id: true },
    });
    if (!concentration) return emptyPage(query);
  }
  if (query.classId && query.concentrationId) {
    const linked = await prisma.schoolClass.findFirst({
      where: { id: query.classId, schoolId, concentrationId: query.concentrationId },
      select: { id: true },
    });
    if (!linked) return emptyPage(query);
  }
  const where: Prisma.StudentWhereInput = {
    schoolId,
    ...(query.classId
      ? { classId: query.classId }
      : scope.kind === "assigned"
        ? { classId: { in: scope.classIds } }
        : {}),
    ...(query.concentrationId ? { class: { is: { schoolId, concentrationId: query.concentrationId } } } : {}),
    ...(query.q
      ? { OR: [{ name: textSearch(query.q) }, { nisn: textSearch(query.q) }, { nis: textSearch(query.q) }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      select: {
        id: true,
        schoolId: true,
        nisn: true,
        nis: true,
        name: true,
        gender: true,
        birthPlace: true,
        birthDate: true,
        email: true,
        phone: true,
        classId: true,
        concentrationId: true,
        isActive: true,
        class: { select: { name: true } },
        concentration: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      ...pageWindow(query),
    }),
    prisma.student.count({ where }),
  ]);
  return { items: rows.map(toStudent), total, page: query.page, pageSize: query.pageSize };
}

async function assertStudentLinks(prisma: PrismaClient, schoolId: string, input: StudentInput) {
  if (input.classId) {
    await ownedRow(prisma.schoolClass.findFirst({ where: { id: input.classId, schoolId }, select: { id: true } }), "Kelas tidak ditemukan di sekolah ini.");
  }
  if (input.concentrationId) {
    await ownedRow(
      prisma.expertiseConcentration.findFirst({ where: { id: input.concentrationId, schoolId }, select: { id: true } }),
      "Konsentrasi keahlian tidak ditemukan di sekolah ini.",
    );
  }
}

async function assertUniqueStudent(prisma: PrismaClient, schoolId: string, input: StudentInput, exceptId?: string) {
  const nisn = await prisma.student.findFirst({
    where: { nisn: input.nisn, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (nisn) duplicate("NISN sudah digunakan.");
  if (input.nis) {
    const nis = await prisma.student.findFirst({
      where: { schoolId, nis: input.nis, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (nis) duplicate("NIS sudah digunakan di sekolah ini.");
  }
}

function studentData(input: StudentInput) {
  const nis = input.nis?.trim() ?? "";
  return {
    ...input,
    nis: nis.length > 0 ? nis : null,
    birthDate: input.birthDate ? parseDateOnly(input.birthDate) : null,
  };
}

export async function createStudent(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: StudentInput,
  meta: RequestMeta,
) {
  await assertStudentLinks(prisma, schoolId, input);
  await assertUniqueStudent(prisma, schoolId, input);
  try {
    const row = await prisma.student.create({
      data: { schoolId, ...studentData(input) },
      include: { class: { select: { name: true } }, concentration: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "STUDENT_CREATED", entityType: "Student", entityId: row.id });
    return toStudent(row);
  } catch (error) {
    rethrowKnown(error, "NISN atau NIS sudah digunakan.");
  }
}

export async function updateStudent(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  id: string,
  input: StudentInput,
  meta: RequestMeta,
) {
  await ownedRow(prisma.student.findFirst({ where: { id, schoolId }, select: { id: true } }), "Siswa tidak ditemukan.");
  await assertStudentLinks(prisma, schoolId, input);
  await assertUniqueStudent(prisma, schoolId, input, id);
  try {
    const row = await prisma.student.update({
      where: { id },
      data: studentData(input),
      include: { class: { select: { name: true } }, concentration: { select: { name: true } } },
    });
    await auditChange(prisma, auth, meta, { schoolId, action: "STUDENT_UPDATED", entityType: "Student", entityId: id });
    return toStudent(row);
  } catch (error) {
    rethrowKnown(error, "NISN atau NIS sudah digunakan.");
  }
}

type StudentTransitionInput = {
  mode: "PROMOTE" | "GRADUATE";
  sourceClassId: string;
  targetClassId?: string;
  graduationYear?: number;
  studentIds: string[];
};

export async function transitionStudents(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  input: StudentTransitionInput,
  meta: RequestMeta,
) {
  const source = await ownedRow(
    prisma.schoolClass.findFirst({ where: { id: input.sourceClassId, schoolId }, select: { id: true } }),
    "Kelas asal tidak ditemukan di sekolah ini.",
  );
  let target: { id: string; concentrationId: string | null } | null = null;
  if (input.mode === "PROMOTE") {
    const targetClassId = input.targetClassId;
    if (!targetClassId) throw new AppError(400, "VALIDATION_ERROR", "Rombel tujuan wajib diisi.");
    target = await ownedRow(
      prisma.schoolClass.findFirst({
        where: { id: targetClassId, schoolId },
        select: { id: true, concentrationId: true },
      }),
      "Kelas tujuan tidak ditemukan di sekolah ini.",
    );
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const studentId of input.studentIds) {
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    ordered.push(studentId);
  }

  const rows = await prisma.student.findMany({
    where: { schoolId, id: { in: ordered } },
    select: {
      id: true,
      name: true,
      nisn: true,
      classId: true,
      isActive: true,
      class: { select: { name: true } },
      concentration: { select: { name: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const failed: Array<{ studentId: string; name: string | null; reason: string }> = [];
  const ready: typeof rows = [];
  for (const studentId of ordered) {
    const row = byId.get(studentId);
    if (!row) {
      failed.push({ studentId, name: null, reason: "Siswa tidak ditemukan di sekolah ini." });
      continue;
    }
    if (row.classId !== source.id) {
      failed.push({ studentId, name: row.name, reason: "Siswa tidak berada di kelas asal. Pemrosesan ganda dicegah." });
      continue;
    }
    if (input.mode === "GRADUATE" && !row.isActive) {
      failed.push({ studentId, name: row.name, reason: "Siswa sudah tidak aktif." });
      continue;
    }
    ready.push(row);
  }

  const succeeded: Array<{ studentId: string; name: string }> = [];
  if (ready.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const row of ready) {
        const updated = await tx.student.updateMany({
          where: {
            id: row.id,
            schoolId,
            classId: source.id,
            ...(input.mode === "GRADUATE" ? { isActive: true } : {}),
          },
          data: target
            ? {
                classId: target.id,
                ...(target.concentrationId ? { concentrationId: target.concentrationId } : {}),
                isActive: true,
              }
            : { classId: null, isActive: false },
        });
        if (updated.count !== 1) {
          failed.push({ studentId: row.id, name: row.name, reason: "Siswa tidak berada di kelas asal. Pemrosesan ganda dicegah." });
          continue;
        }
        if (input.mode === "GRADUATE") {
          await linkGraduatedAlumni(tx, auth, schoolId, row, input.graduationYear ?? new Date().getUTCFullYear(), meta);
        }
        await writeAudit(tx, {
          schoolId,
          actorId: auth.userId,
          action: input.mode === "PROMOTE" ? "STUDENT_PROMOTED" : "STUDENT_GRADUATED",
          entityType: "Student",
          entityId: row.id,
          metadata: {
            sourceClassId: source.id,
            targetClassId: target?.id ?? null,
            graduationYear: input.mode === "GRADUATE" ? (input.graduationYear ?? null) : null,
            nisn: input.mode === "GRADUATE" ? row.nisn : null,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        succeeded.push({ studentId: row.id, name: row.name });
      }
    }, { timeout: 20_000 });
  }

  return { succeeded, failed };
}

async function linkGraduatedAlumni(
  tx: Prisma.TransactionClient,
  auth: AuthState,
  schoolId: string,
  student: { id: string; name: string; nisn: string; class: { name: string } | null; concentration: { name: string } | null },
  graduationYear: number,
  meta: RequestMeta,
) {
  const alumniName = student.name.slice(0, 160);
  const majorName = (student.concentration?.name || student.class?.name || "Umum").slice(0, 120);
  const existing = await tx.alumniTracer.findFirst({
    where: { schoolId, studentId: student.id, graduationYear },
    select: { id: true },
  });
  const tracer = existing ?? await tx.alumniTracer.create({
    data: {
      schoolId,
      studentId: student.id,
      alumniName,
      graduationYear,
      majorName,
      status: "BELUM_BEKERJA",
    },
    select: { id: true },
  });
  const linked = await tx.auditLog.findFirst({
    where: { schoolId, action: "ALUMNI_TRACER_FROM_GRADUATION", entityType: "Student", entityId: student.id },
    select: { id: true },
  });
  if (linked) return;
  await writeAudit(tx, {
    schoolId,
    actorId: auth.userId,
    action: "ALUMNI_TRACER_FROM_GRADUATION",
    entityType: "Student",
    entityId: student.id,
    metadata: { tracerId: tracer.id, nisn: student.nisn, graduationYear, majorName },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function deleteStudent(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string, meta: RequestMeta) {
  await ownedRow(prisma.student.findFirst({ where: { id, schoolId }, select: { id: true } }), "Siswa tidak ditemukan.");
  const [formative, summative, term] = await Promise.all([
    prisma.formativeScore.count({ where: { studentId: id } }),
    prisma.summativeScore.count({ where: { studentId: id } }),
    prisma.termExamScore.count({ where: { studentId: id } }),
  ]);
  if (formative + summative + term > 0) inUse("Siswa masih memiliki nilai.");
  await prisma.student.delete({ where: { id } });
  await auditChange(prisma, auth, meta, { schoolId, action: "STUDENT_DELETED", entityType: "Student", entityId: id });
}
