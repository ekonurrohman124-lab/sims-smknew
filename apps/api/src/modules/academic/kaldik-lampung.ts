import type { PrismaClient } from "@prisma/client";
import { toDateOnly } from "./common.ts";

export const KALDIK_LAMPUNG_SOURCE =
  "Keputusan Kepala Dinas Pendidikan dan Kebudayaan Provinsi Lampung Nomor 400.3.8/1323/V.01/DP.2/2026";

export const KALDIK_LAMPUNG_WARNING =
  "Lampiran SK belum diverifikasi di aplikasi. Ringkasan sekunder berbeda pada tanggal mulai, 13 Juli 2026 atau 14 Juli 2026. Tanggal di bawah ini kandidat pembelajaran, bukan tanggal administratif yang sudah dikunci. Tahun pelajaran tidak diaktifkan dan tanggalnya tidak diubah.";

export const KALDIK_YEAR_NAME = "2026/2027";
export const KALDIK_YEAR_START_CANDIDATE = "2026-07-13";

export const KALDIK_SEMESTERS = [
  { semesterKind: "GANJIL" as const, name: "Semester Ganjil 2026/2027", startDate: "2026-07-13", endDate: "2026-12-18" },
  { semesterKind: "GENAP" as const, name: "Semester Genap 2026/2027", startDate: "2027-01-06", endDate: "2027-06-11" },
];

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA;
}

export function kaldikCandidatesOverlap(): boolean {
  const odd = KALDIK_SEMESTERS[0];
  const even = KALDIK_SEMESTERS[1];
  if (!odd || !even) return false;
  return rangesOverlap(odd.startDate, odd.endDate, even.startDate, even.endDate);
}

export async function previewKaldik(prisma: PrismaClient, schoolId: string) {
  const year = await prisma.academicYear.findFirst({
    where: { schoolId, name: KALDIK_YEAR_NAME },
    select: { id: true, name: true, startDate: true, endDate: true, isActive: true },
  });
  const periods = year
    ? await prisma.academicPeriod.findMany({
        where: { schoolId, academicYearId: year.id },
        select: { id: true, semesterKind: true, name: true, startDate: true, endDate: true },
      })
    : [];
  return {
    source: KALDIK_LAMPUNG_SOURCE,
    verification: "BELUM_TERVERIFIKASI" as const,
    warning: KALDIK_LAMPUNG_WARNING,
    yearStartCandidate: KALDIK_YEAR_START_CANDIDATE,
    yearEndCandidate: null,
    overlap: kaldikCandidatesOverlap(),
    year: year
      ? {
          id: year.id,
          name: year.name,
          startDate: toDateOnly(year.startDate),
          endDate: toDateOnly(year.endDate),
          isActive: year.isActive,
          action: "REUSE" as const,
          dateChange: "TIDAK_DIUBAH" as const,
        }
      : null,
    semesters: KALDIK_SEMESTERS.map((candidate) => {
      const existing = periods.find((period) => period.semesterKind === candidate.semesterKind);
      return {
        ...candidate,
        isActive: false,
        action: !year ? ("YEAR_MISSING" as const) : existing ? ("REUSE" as const) : ("CREATE" as const),
        existingId: existing?.id ?? null,
        storedStart: existing ? toDateOnly(existing.startDate) : null,
        storedEnd: existing ? toDateOnly(existing.endDate) : null,
      };
    }),
  };
}
