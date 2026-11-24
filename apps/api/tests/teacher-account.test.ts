import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { ApiErrorBody, LoginResponse, PageResult, TeacherAccountResult, TeacherRosterDto } from "@sims/shared";
import {
  assignRole,
  authHeader,
  closeTestContext,
  createSchool,
  createTestContext,
  createUser,
  jsonBody,
  loginRequest,
  migrateTestDatabase,
  resetDatabase,
  type TestContext,
} from "./helpers.ts";

const PASSWORD = "RahasiaUji!2026";
const NEXT_PASSWORD = "SandiBaru!2026";

async function tokenFor(context: TestContext, email: string, password = PASSWORD): Promise<string> {
  const response = await loginRequest(context.app, email, password);
  assert.equal(response.statusCode, 200, response.body);
  return jsonBody<LoginResponse>(response).accessToken;
}

describe("Akun guru", { concurrency: 1 }, () => {
  let context: TestContext;

  before(async () => {
    migrateTestDatabase();
    context = await createTestContext();
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  after(async () => {
    await closeTestContext(context);
  });

  it("membuat akun dari email guru, mewajibkan ganti sandi, lalu mengizinkan reset", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Akun", npsn: "30100001" });
    const other = await createSchool(context.prisma, { name: "SMK Lain", npsn: "30100002" });
    const admin = await createUser(context.prisma, { email: "admin.akun@sekolah.test", name: "Admin Akun", password: PASSWORD });
    const neighbor = await createUser(context.prisma, { email: "admin.lain@sekolah.test", name: "Admin Lain", password: PASSWORD });
    const owner = await createUser(context.prisma, { email: "owner.akun@sekolah.test", name: "Pemilik", password: PASSWORD });
    await assignRole(context.prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await assignRole(context.prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    await assignRole(context.prisma, { userId: owner.id, roleCode: "SYSTEM_OWNER", schoolId: null });
    const ownerBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const adminBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });

    const teacher = await context.prisma.teacher.create({
      data: { schoolId: school.id, name: "Guru Baru", gender: "PEREMPUAN", email: "Guru.Baru@sekolah.test", isActive: true },
    });
    const adminToken = await tokenFor(context, admin.email);
    const created = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${teacher.id}/account`,
      headers: authHeader(adminToken),
    });
    assert.equal(created.statusCode, 201, created.body);
    const account = jsonBody<TeacherAccountResult>(created);
    assert.equal(account.created, true);
    assert.equal(account.item.email, "Guru.Baru@sekolah.test");
    assert.ok(account.temporaryPassword && account.temporaryPassword.length >= 16);
    const linkedUser = await context.prisma.user.findUniqueOrThrow({
      where: { email: "guru.baru@sekolah.test" },
      include: { assignments: { include: { role: true } } },
    });
    assert.equal(linkedUser.mustChangePassword, true);
    assert.equal(linkedUser.assignments.length, 1);
    assert.equal(linkedUser.assignments[0]?.role.code, "GURU_MAPEL");
    assert.equal(linkedUser.assignments[0]?.schoolId, school.id);

    const firstLogin = await loginRequest(context.app, "guru.baru@sekolah.test", account.temporaryPassword);
    assert.equal(firstLogin.statusCode, 200, firstLogin.body);
    const session = jsonBody<LoginResponse>(firstLogin);
    assert.equal(session.user.mustChangePassword, true);
    const blocked = await context.app.inject({
      method: "GET",
      url: `/api/v1/schools/${school.id}/teachers`,
      headers: authHeader(session.accessToken),
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(jsonBody<ApiErrorBody>(blocked).error.code, "PASSWORD_CHANGE_REQUIRED");

    const changed = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: authHeader(session.accessToken),
      payload: { currentPassword: account.temporaryPassword, newPassword: NEXT_PASSWORD },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(jsonBody<{ user: LoginResponse["user"] }>(changed).user.mustChangePassword, false);
    const afterChange = await loginRequest(context.app, "guru.baru@sekolah.test", NEXT_PASSWORD);
    assert.equal(afterChange.statusCode, 200, afterChange.body);
    assert.equal(jsonBody<LoginResponse>(afterChange).user.mustChangePassword, false);

    const reset = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${teacher.id}/reset-password`,
      headers: authHeader(adminToken),
    });
    assert.equal(reset.statusCode, 200, reset.body);
    const resetBody = jsonBody<TeacherAccountResult>(reset);
    assert.ok(resetBody.temporaryPassword);
    assert.notEqual(resetBody.temporaryPassword, account.temporaryPassword);
    const oldPassword = await loginRequest(context.app, "guru.baru@sekolah.test", NEXT_PASSWORD);
    assert.equal(oldPassword.statusCode, 401);
    const resetLogin = await loginRequest(context.app, "guru.baru@sekolah.test", resetBody.temporaryPassword ?? "");
    assert.equal(resetLogin.statusCode, 200, resetLogin.body);
    assert.equal(jsonBody<LoginResponse>(resetLogin).user.mustChangePassword, true);

    const outsider = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${teacher.id}/reset-password`,
      headers: authHeader(await tokenFor(context, neighbor.email)),
    });
    assert.equal(outsider.statusCode, 403);
    assert.equal(jsonBody<ApiErrorBody>(outsider).error.code, "TENANT_FORBIDDEN");

    const ownerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const adminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(ownerAfter.passwordHash, ownerBefore.passwordHash);
    assert.equal(ownerAfter.mustChangePassword, false);
    assert.equal(adminAfter.passwordHash, adminBefore.passwordHash);
    assert.equal(adminAfter.mustChangePassword, false);
  });

  it("menghubungkan akun yang sudah ada tanpa duplikat dan menolak akun terlindungi", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Hubung", npsn: "30100003" });
    const other = await createSchool(context.prisma, { name: "SMK Jauh", npsn: "30100004" });
    const admin = await createUser(context.prisma, { email: "admin.hubung@sekolah.test", name: "Admin Hubung", password: PASSWORD });
    const existing = await createUser(context.prisma, { email: "guru.lama@sekolah.test", name: "Guru Lama", password: PASSWORD });
    const outsider = await createUser(context.prisma, { email: "guru.jauh@sekolah.test", name: "Guru Jauh", password: PASSWORD });
    const owner = await createUser(context.prisma, { email: "owner.hubung@sekolah.test", name: "Pemilik Hubung", password: PASSWORD });
    await assignRole(context.prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await assignRole(context.prisma, { userId: existing.id, roleCode: "WALI_KELAS", schoolId: school.id });
    await assignRole(context.prisma, { userId: outsider.id, roleCode: "GURU_MAPEL", schoolId: other.id });
    await assignRole(context.prisma, { userId: owner.id, roleCode: "SYSTEM_OWNER", schoolId: null });
    const existingBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    const outsiderBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: outsider.id } });
    const ownerBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });

    const linkedTeacher = await context.prisma.teacher.create({
      data: { schoolId: school.id, name: "Guru Lama", gender: "LAKI_LAKI", email: "guru.lama@sekolah.test", isActive: true },
    });
    const foreignTeacher = await context.prisma.teacher.create({
      data: { schoolId: school.id, name: "Bukan Sekolah Ini", gender: "LAKI_LAKI", email: "guru.jauh@sekolah.test", isActive: true },
    });
    const ownerTeacher = await context.prisma.teacher.create({
      data: { schoolId: school.id, name: "Salah Owner", gender: "PEREMPUAN", email: "owner.hubung@sekolah.test", isActive: true },
    });
    const token = await tokenFor(context, admin.email);

    const linked = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${linkedTeacher.id}/account`,
      headers: authHeader(token),
    });
    assert.equal(linked.statusCode, 200, linked.body);
    const linkedBody = jsonBody<TeacherAccountResult>(linked);
    assert.equal(linkedBody.created, false);
    assert.equal(linkedBody.temporaryPassword, null);
    assert.equal(linkedBody.item.userId, existing.id);
    assert.equal(await context.prisma.user.count({ where: { email: "guru.lama@sekolah.test" } }), 1);
    const roles = await context.prisma.userRole.findMany({
      where: { userId: existing.id, isActive: true },
      include: { role: true },
    });
    assert.deepEqual(roles.map((role) => role.role.code).sort(), ["GURU_MAPEL", "WALI_KELAS"]);
    const existingAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(existingAfter.passwordHash, existingBefore.passwordHash);
    assert.equal(existingAfter.mustChangePassword, false);
    assert.equal(existingAfter.name, "Guru Lama");
    const stillWorks = await loginRequest(context.app, existing.email, PASSWORD);
    assert.equal(stillWorks.statusCode, 200, stillWorks.body);
    assert.equal(jsonBody<LoginResponse>(stillWorks).user.mustChangePassword, false);

    const foreign = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${foreignTeacher.id}/account`,
      headers: authHeader(token),
    });
    assert.equal(foreign.statusCode, 409);
    assert.equal(jsonBody<ApiErrorBody>(foreign).error.code, "ACCOUNT_UNCHANGED");
    const outsiderAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: outsider.id } });
    assert.equal(outsiderAfter.passwordHash, outsiderBefore.passwordHash);
    assert.equal(await context.prisma.teacher.findUniqueOrThrow({ where: { id: foreignTeacher.id } }).then((row) => row.userId), null);

    const protectedOwner = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${ownerTeacher.id}/account`,
      headers: authHeader(token),
    });
    assert.equal(protectedOwner.statusCode, 409);
    const ownerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: owner.id }, include: { assignments: true } });
    assert.equal(ownerAfter.passwordHash, ownerBefore.passwordHash);
    assert.equal(ownerAfter.assignments.length, 1);
    assert.equal(await context.prisma.teacher.findUniqueOrThrow({ where: { id: ownerTeacher.id } }).then((row) => row.userId), null);

    const resetProtected = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${linkedTeacher.id}/reset-password`,
      headers: authHeader(token),
    });
    assert.equal(resetProtected.statusCode, 200, resetProtected.body);
  });

  it("melepas tautan akun yang salah tanpa mengubah akun, penugasan, atau sekolah lain", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Lepas", npsn: "30100005" });
    const other = await createSchool(context.prisma, { name: "SMK Tetap", npsn: "30100006" });
    const admin = await createUser(context.prisma, { email: "admin.lepas@sekolah.test", name: "Admin Lepas", password: PASSWORD });
    const neighbor = await createUser(context.prisma, { email: "admin.tetap@sekolah.test", name: "Admin Tetap", password: PASSWORD });
    const siti = await createUser(context.prisma, { email: "siti.lepas@sekolah.test", name: "Siti Multi Peran", password: PASSWORD });
    await assignRole(context.prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await assignRole(context.prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    await assignRole(context.prisma, { userId: siti.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await assignRole(context.prisma, { userId: siti.id, roleCode: "WALI_KELAS", schoolId: school.id });
    await assignRole(context.prisma, { userId: siti.id, roleCode: "TU", schoolId: other.id });

    const year = await context.prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: "2026/2027",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
        isActive: true,
      },
    });
    const period = await context.prisma.academicPeriod.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: "2026/2027 Ganjil",
        semesterKind: "GANJIL",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
        isActive: true,
      },
    });
    const subject = await context.prisma.subject.create({
      data: { schoolId: school.id, code: "MTK", name: "Matematika", category: "UMUM", isActive: true },
    });
    const schoolClass = await context.prisma.schoolClass.create({
      data: { schoolId: school.id, academicYearId: year.id, name: "X Toji", gradeLevel: 10, capacity: 32, isActive: true },
    });
    const toji = await context.prisma.teacher.create({
      data: {
        schoolId: school.id,
        userId: siti.id,
        name: "TOJI",
        gender: "LAKI_LAKI",
        email: "toji.lepas@sekolah.test",
        nip: "098765345678",
        isActive: true,
      },
    });
    const teaching = await context.prisma.teachingAssignment.create({
      data: {
        schoolId: school.id,
        teacherId: toji.id,
        subjectId: subject.id,
        classId: schoolClass.id,
        academicPeriodId: period.id,
      },
    });
    const otherTeacher = await context.prisma.teacher.create({
      data: { schoolId: other.id, name: "Guru Tetap", gender: "PEREMPUAN", email: "tetap@sekolah.test", isActive: true },
    });
    const sitiBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: siti.id } });
    const rolesBefore = await context.prisma.userRole.count({ where: { userId: siti.id, isActive: true } });
    const token = await tokenFor(context, admin.email);

    const denied = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${toji.id}/unlink-account`,
      headers: authHeader(await tokenFor(context, neighbor.email)),
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(jsonBody<ApiErrorBody>(denied).error.code, "TENANT_FORBIDDEN");

    const unlinked = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${toji.id}/unlink-account`,
      headers: authHeader(token),
    });
    assert.equal(unlinked.statusCode, 200, unlinked.body);
    const body = jsonBody<TeacherAccountResult>(unlinked);
    assert.equal(body.item.userId, null);
    assert.equal(body.item.name, "TOJI");
    assert.equal(body.item.email, "toji.lepas@sekolah.test");
    assert.equal(body.item.nip, "098765345678");
    assert.equal(body.temporaryPassword, null);

    const teacherAfter = await context.prisma.teacher.findUniqueOrThrow({ where: { id: toji.id } });
    assert.equal(teacherAfter.userId, null);
    assert.equal(teacherAfter.name, "TOJI");
    const assignmentAfter = await context.prisma.teachingAssignment.findUniqueOrThrow({ where: { id: teaching.id } });
    assert.equal(assignmentAfter.teacherId, toji.id);
    assert.equal(assignmentAfter.schoolId, school.id);
    const sitiAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: siti.id } });
    assert.equal(sitiAfter.passwordHash, sitiBefore.passwordHash);
    assert.equal(sitiAfter.email, "siti.lepas@sekolah.test");
    assert.equal(sitiAfter.name, "Siti Multi Peran");
    assert.equal(sitiAfter.isActive, true);
    assert.equal(await context.prisma.userRole.count({ where: { userId: siti.id, isActive: true } }), rolesBefore);
    assert.equal((await context.prisma.teacher.findUniqueOrThrow({ where: { id: otherTeacher.id } })).userId, null);
    const audit = await context.prisma.auditLog.findFirst({
      where: { action: "TEACHER_ACCOUNT_UNLINKED", entityId: toji.id, schoolId: school.id },
    });
    assert.ok(audit);
    assert.equal((audit?.metadata as { previousUserId?: string } | null)?.previousUserId, siti.id);

    const created = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/teachers/${toji.id}/account`,
      headers: authHeader(token),
    });
    assert.equal(created.statusCode, 201, created.body);
    const account = jsonBody<TeacherAccountResult>(created);
    assert.equal(account.created, true);
    assert.equal(account.item.email, "toji.lepas@sekolah.test");
    assert.notEqual(account.item.userId, siti.id);
    const sitiFinal = await context.prisma.user.findUniqueOrThrow({ where: { id: siti.id } });
    assert.equal(sitiFinal.passwordHash, sitiBefore.passwordHash);
    assert.equal(await context.prisma.user.count({ where: { email: "siti.lepas@sekolah.test" } }), 1);
    assert.equal(await context.prisma.teachingAssignment.count({ where: { id: teaching.id, teacherId: toji.id } }), 1);
  });

  it("membuat guru dan akun sekaligus, menolak data parsial, lalu menghubungkan email yang sudah ada", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Gabung", npsn: "30100011" });
    const other = await createSchool(context.prisma, { name: "SMK Gabung Lain", npsn: "30100012" });
    const owner = await createUser(context.prisma, { email: "owner.gabung@sekolah.test", name: "Pemilik", password: PASSWORD });
    const neighbor = await createUser(context.prisma, { email: "admin.gabung.lain@sekolah.test", name: "Admin Lain", password: PASSWORD });
    const outsider = await createUser(context.prisma, { email: "tu.gabung.lain@sekolah.test", name: "TU Sekolah Lain", password: PASSWORD });
    const staff = await createUser(context.prisma, { email: "tu.gabung@sekolah.test", name: "TU Gabung", password: PASSWORD });
    await assignRole(context.prisma, { userId: owner.id, roleCode: "SYSTEM_OWNER", schoolId: null });
    await assignRole(context.prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    await assignRole(context.prisma, { userId: outsider.id, roleCode: "TU", schoolId: other.id });
    await assignRole(context.prisma, { userId: staff.id, roleCode: "TU", schoolId: school.id });
    const staffBefore = await context.prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
    const ownerToken = await tokenFor(context, owner.email);
    const url = `/api/v1/schools/${school.id}/teachers/with-account`;
    const beforeUsers = await context.prisma.user.count();
    const beforeTeachers = await context.prisma.teacher.count();

    const invalid = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "A", email: "bukan-email", gender: "LAKI_LAKI", roles: ["GURU_MAPEL"], isActive: true },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(await context.prisma.user.count(), beforeUsers);
    assert.equal(await context.prisma.teacher.count(), beforeTeachers);

    const created = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "Guru Gabungan", email: "guru.gabungan@sekolah.test", gender: "PEREMPUAN", nip: "12345678", phone: "08111", roles: ["GURU_MAPEL", "WALI_KELAS"], isActive: true },
    });
    assert.equal(created.statusCode, 201, created.body);
    const account = jsonBody<TeacherAccountResult>(created);
    assert.equal(account.created, true);
    assert.deepEqual(account.item.roleCodes.sort(), ["GURU_MAPEL", "WALI_KELAS"]);
    assert.equal(account.item.loginEmail, "guru.gabungan@sekolah.test");
    const login = await loginRequest(context.app, "guru.gabungan@sekolah.test", account.temporaryPassword ?? "");
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(jsonBody<LoginResponse>(login).user.mustChangePassword, true);

    const sameNip = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "Guru NIP Sama", email: "guru.nip.sama@sekolah.test", gender: "LAKI_LAKI", nip: "12345678", roles: ["GURU_MAPEL"], isActive: true },
    });
    assert.equal(sameNip.statusCode, 409, sameNip.body);
    assert.equal(await context.prisma.user.count({ where: { email: "guru.nip.sama@sekolah.test" } }), 0);
    assert.equal(await context.prisma.teacher.count({ where: { nip: "12345678" } }), 1);

    const duplicate = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "Guru Lain", email: "guru.gabungan@sekolah.test", gender: "LAKI_LAKI", roles: ["GURU_MAPEL"], isActive: true },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(await context.prisma.user.count({ where: { email: "guru.gabungan@sekolah.test" } }), 1);
    assert.equal(await context.prisma.teacher.count({ where: { email: "guru.gabungan@sekolah.test" } }), 1);

    const blocked = await context.app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/users`,
      headers: authHeader(ownerToken),
      payload: { name: "Guru Lewat Pengguna", email: "guru.lewat.pengguna@sekolah.test", roles: ["GURU_MAPEL"], teacherId: null },
    });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(await context.prisma.user.count({ where: { email: "guru.lewat.pengguna@sekolah.test" } }), 0);

    const offer = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "TU Juga Guru", email: staff.email, gender: "LAKI_LAKI", roles: ["GURU_MAPEL"], isActive: true },
    });
    assert.equal(offer.statusCode, 409, offer.body);
    assert.equal(jsonBody<ApiErrorBody>(offer).error.code, "ACCOUNT_EXISTS");
    assert.equal(await context.prisma.teacher.count({ where: { userId: staff.id } }), 0);

    const linked = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "TU Juga Guru", email: staff.email, gender: "LAKI_LAKI", roles: ["GURU_MAPEL", "WALI_KELAS"], isActive: true, linkExisting: true },
    });
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(jsonBody<TeacherAccountResult>(linked).temporaryPassword, null);
    const staffAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: staff.id }, include: { assignments: { include: { role: true } } } });
    assert.equal(staffAfter.passwordHash, staffBefore.passwordHash);
    assert.equal(staffAfter.assignments.filter((item) => item.isActive && item.role.code === "TU").length, 1);
    assert.equal(staffAfter.assignments.filter((item) => item.isActive && (item.role.code === "GURU_MAPEL" || item.role.code === "WALI_KELAS")).length, 2);

    const crossSchool = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(ownerToken),
      payload: { name: "Guru Silang", email: outsider.email, gender: "PEREMPUAN", roles: ["GURU_MAPEL"], isActive: true, linkExisting: true },
    });
    assert.equal(crossSchool.statusCode, 409, crossSchool.body);
    assert.equal(jsonBody<ApiErrorBody>(crossSchool).error.code, "ACCOUNT_UNCHANGED");
    assert.equal(await context.prisma.teacher.count({ where: { userId: outsider.id } }), 0);

    const foreign = await context.app.inject({
      method: "POST",
      url,
      headers: authHeader(await tokenFor(context, neighbor.email)),
    });
    assert.equal(foreign.statusCode, 403, foreign.body);
  });

  it("menampilkan akun guru yang belum tertaut dan menghubungkan profil tanpa membuat akun baru", async () => {
    const school = await createSchool(context.prisma, { name: "SMK Tautan", npsn: "30100021" });
    const other = await createSchool(context.prisma, { name: "SMK Tautan Lain", npsn: "30100022" });
    const admin = await createUser(context.prisma, { email: "admin.tautan@sekolah.test", name: "Admin Tautan", password: PASSWORD });
    const neighbor = await createUser(context.prisma, { email: "admin.tautan.lain@sekolah.test", name: "Admin Lain", password: PASSWORD });
    const guru = await createUser(context.prisma, { email: "guru.tautan@sekolah.test", name: "Guru Rangkap", password: PASSWORD });
    const wali = await createUser(context.prisma, { email: "wali.tautan@sekolah.test", name: "Wali Belum", password: PASSWORD });
    const outsider = await createUser(context.prisma, { email: "guru.luar.tautan@sekolah.test", name: "Guru Luar", password: PASSWORD });
    const staff = await createUser(context.prisma, { email: "tu.tautan@sekolah.test", name: "TU Tautan", password: PASSWORD });
    await assignRole(context.prisma, { userId: admin.id, roleCode: "ADMIN_SEKOLAH", schoolId: school.id });
    await assignRole(context.prisma, { userId: neighbor.id, roleCode: "ADMIN_SEKOLAH", schoolId: other.id });
    await assignRole(context.prisma, { userId: guru.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await assignRole(context.prisma, { userId: guru.id, roleCode: "KAPROG", schoolId: school.id });
    await assignRole(context.prisma, { userId: wali.id, roleCode: "GURU_MAPEL", schoolId: school.id });
    await assignRole(context.prisma, { userId: wali.id, roleCode: "WALI_KELAS", schoolId: school.id });
    await assignRole(context.prisma, { userId: outsider.id, roleCode: "GURU_MAPEL", schoolId: other.id });
    await assignRole(context.prisma, { userId: staff.id, roleCode: "TU", schoolId: school.id });
    const before = await context.prisma.user.findUniqueOrThrow({
      where: { id: guru.id },
      include: { assignments: { where: { isActive: true }, include: { role: true } } },
    });
    const usersBefore = await context.prisma.user.count();
    const adminToken = await tokenFor(context, admin.email);
    const url = `/api/v1/schools/${school.id}/teachers`;

    const listed = await context.app.inject({ method: "GET", url: `${url}?page=1&pageSize=50`, headers: authHeader(adminToken) });
    assert.equal(listed.statusCode, 200, listed.body);
    const roster = jsonBody<PageResult<TeacherRosterDto>>(listed);
    assert.equal(roster.total, 2);
    assert.equal(roster.items.every((item) => item.linkStatus === "BELUM_TERHUBUNG"), true);
    assert.deepEqual(roster.items.map((item) => item.userId).sort(), [guru.id, wali.id].sort());
    assert.equal(roster.items.some((item) => item.userId === outsider.id || item.userId === staff.id), false);
    const guruRow = roster.items.find((item) => item.userId === guru.id);
    const waliRow = roster.items.find((item) => item.userId === wali.id);
    assert.deepEqual(guruRow?.roleCodes, ["GURU_MAPEL"]);
    assert.deepEqual(waliRow?.roleCodes.sort(), ["GURU_MAPEL", "WALI_KELAS"]);
    assert.equal(guruRow?.name, "Guru Rangkap");
    assert.equal(guruRow?.loginEmail, guru.email);

    const denied = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(await tokenFor(context, guru.email)),
      payload: { userId: wali.id, name: waliRow?.name, gender: "LAKI_LAKI" },
    });
    assert.equal(denied.statusCode, 403, denied.body);

    const foreign = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(adminToken),
      payload: { userId: outsider.id, name: "Guru Luar", gender: "PEREMPUAN" },
    });
    assert.equal(foreign.statusCode, 404, foreign.body);

    const linked = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(adminToken),
      payload: { userId: guru.id, name: "Guru Rangkap", gender: "PEREMPUAN", nip: "12345678" },
    });
    assert.equal(linked.statusCode, 201, linked.body);
    const created = jsonBody<TeacherAccountResult>(linked);
    assert.equal(created.created, true);
    assert.equal(created.temporaryPassword, null);
    assert.equal(created.item.userId, guru.id);
    assert.equal(created.item.gender, "PEREMPUAN");
    assert.equal(created.item.email, guru.email);
    assert.equal(await context.prisma.user.count(), usersBefore);
    assert.equal(await context.prisma.teacher.count({ where: { userId: guru.id } }), 1);

    const after = await context.prisma.user.findUniqueOrThrow({
      where: { id: guru.id },
      include: { assignments: { where: { isActive: true }, include: { role: true } } },
    });
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(after.email, before.email);
    assert.equal(after.isActive, before.isActive);
    assert.deepEqual(
      after.assignments.map((item) => item.role.code).sort(),
      before.assignments.map((item) => item.role.code).sort(),
    );
    assert.equal(after.assignments.some((item) => item.role.code === "KAPROG"), true);

    const repeat = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(adminToken),
      payload: { userId: guru.id, name: "Nama Lain", gender: "LAKI_LAKI" },
    });
    assert.equal(repeat.statusCode, 200, repeat.body);
    const repeated = jsonBody<TeacherAccountResult>(repeat);
    assert.equal(repeated.created, false);
    assert.equal(repeated.temporaryPassword, null);
    assert.equal(repeated.item.gender, "PEREMPUAN");
    assert.equal(repeated.item.name, "Guru Rangkap");
    assert.equal(await context.prisma.teacher.count({ where: { userId: guru.id } }), 1);

    const sameNip = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(adminToken),
      payload: { userId: wali.id, name: "Wali Belum", gender: "LAKI_LAKI", nip: "12345678" },
    });
    assert.equal(sameNip.statusCode, 409, sameNip.body);
    assert.equal(await context.prisma.teacher.count({ where: { userId: wali.id } }), 0);

    const afterList = await context.app.inject({ method: "GET", url: `${url}?page=1&pageSize=10`, headers: authHeader(adminToken) });
    const afterRoster = jsonBody<PageResult<TeacherRosterDto>>(afterList);
    assert.equal(afterRoster.total, 2);
    assert.equal(afterRoster.items.find((item) => item.userId === guru.id)?.linkStatus, "TERHUBUNG");
    assert.equal(afterRoster.items.find((item) => item.userId === wali.id)?.linkStatus, "BELUM_TERHUBUNG");

    const ownList = await context.app.inject({
      method: "GET",
      url: `${url}?page=1&pageSize=50`,
      headers: authHeader(await tokenFor(context, guru.email)),
    });
    const ownRoster = jsonBody<PageResult<TeacherRosterDto>>(ownList);
    assert.equal(ownRoster.total, 1);
    assert.equal(ownRoster.items[0]?.userId, guru.id);
    assert.equal(ownRoster.items[0]?.linkStatus, "TERHUBUNG");

    const outsiderAdmin = await context.app.inject({
      method: "POST",
      url: `${url}/link-profile`,
      headers: authHeader(await tokenFor(context, neighbor.email)),
      payload: { userId: wali.id, name: "Wali Belum", gender: "LAKI_LAKI" },
    });
    assert.equal(outsiderAdmin.statusCode, 403, outsiderAdmin.body);
  });
});
