import type { AuthUserDto, RoleCode } from "@sims/shared";

const ACADEMIC_READ_ROLES: readonly RoleCode[] = ["ADMIN_SEKOLAH", "OPERATOR_SEKOLAH", "WAKAKUR", "KEPALA_SEKOLAH", "TU"];

export type AcademicNavItem = { to: string; label: string };

export const ACADEMIC_NAV: readonly AcademicNavItem[] = [
  { to: "/tahun-pelajaran", label: "Tahun Pelajaran" },
  { to: "/semester", label: "Semester" },
  { to: "/kalender-pendidikan", label: "Kalender Pendidikan" },
  { to: "/bidang", label: "Bidang Keahlian" },
  { to: "/program", label: "Program Keahlian" },
  { to: "/konsentrasi", label: "Konsentrasi Keahlian" },
  { to: "/kelas", label: "Kelas" },
  { to: "/mapel", label: "Mata Pelajaran" },
  { to: "/penugasan", label: "Penugasan Guru" },
];

function rolesAtSchool(user: AuthUserDto, schoolId: string): RoleCode[] {
  return user.assignments
    .filter((assignment) => assignment.roleCode === "SYSTEM_OWNER" || assignment.schoolId === schoolId)
    .map((assignment) => assignment.roleCode);
}

export function canReadAcademicMaster(user: AuthUserDto | null, schoolId: string): boolean {
  if (!user || !schoolId) return false;
  const roles = rolesAtSchool(user, schoolId);
  return roles.includes("SYSTEM_OWNER") || roles.some((role) => ACADEMIC_READ_ROLES.includes(role));
}

export function academicNavItems(user: AuthUserDto | null, schoolId: string): AcademicNavItem[] {
  return canReadAcademicMaster(user, schoolId) ? [...ACADEMIC_NAV] : [];
}

export function showsAcademicGroup(user: AuthUserDto | null, schoolId: string): boolean {
  if (!user || !schoolId) return false;
  const roles = rolesAtSchool(user, schoolId);
  return roles.includes("SYSTEM_OWNER") || roles.includes("ADMIN_SEKOLAH") || roles.includes("OPERATOR_SEKOLAH") || roles.includes("WAKAKUR");
}

export function usesWakakurAcademicNav(user: AuthUserDto | null, schoolId: string): boolean {
  if (!user || !schoolId) return false;
  const roles = rolesAtSchool(user, schoolId);
  const schoolAdmin = roles.includes("SYSTEM_OWNER") || roles.includes("ADMIN_SEKOLAH") || roles.includes("OPERATOR_SEKOLAH");
  return roles.includes("WAKAKUR") && !schoolAdmin;
}
