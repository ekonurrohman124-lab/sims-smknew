import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUserDto } from "@sims/shared";
import { academicNavItems, showsAcademicGroup, usesWakakurAcademicNav } from "./academicNav.ts";

function user(assignments: AuthUserDto["assignments"]): AuthUserDto {
  return { id: "user-1", email: "uji@local", name: "Uji", mustChangePassword: false, assignments };
}

const school = { roleName: "Peran", scope: "SCHOOL" as const, schoolId: "school-a", schoolName: "Sekolah A" };

describe("navigasi akademik wakakur", () => {
  it("menampilkan master yang boleh dibaca dan menyembunyikannya tanpa izin", () => {
    const wakakur = user([{ ...school, roleCode: "WAKAKUR" }]);
    assert.deepEqual(academicNavItems(wakakur, "school-a").map((item) => item.label), [
      "Tahun Pelajaran",
      "Semester",
      "Kalender Pendidikan",
      "Bidang Keahlian",
      "Program Keahlian",
      "Konsentrasi Keahlian",
      "Kelas",
      "Mata Pelajaran",
      "Penugasan Guru",
    ]);
    assert.equal(usesWakakurAcademicNav(wakakur, "school-a"), true);
    assert.equal(showsAcademicGroup(wakakur, "school-a"), true);
    assert.equal(showsAcademicGroup(user([{ ...school, roleCode: "ADMIN_SEKOLAH" }]), "school-a"), true);
    assert.deepEqual(academicNavItems(user([{ ...school, roleCode: "GURU_MAPEL" }]), "school-a"), []);
    assert.equal(showsAcademicGroup(user([{ ...school, roleCode: "GURU_MAPEL" }]), "school-a"), false);
    assert.equal(usesWakakurAcademicNav(user([{ ...school, roleCode: "ADMIN_SEKOLAH" }]), "school-a"), false);
    assert.equal(showsAcademicGroup(user([{ ...school, roleCode: "WAKAKUR" }, { ...school, roleCode: "ADMIN_SEKOLAH" }]), "school-a"), true);
    assert.equal(usesWakakurAcademicNav(user([{ ...school, roleCode: "WAKAKUR" }, { ...school, roleCode: "ADMIN_SEKOLAH" }]), "school-a"), false);
  });
});
