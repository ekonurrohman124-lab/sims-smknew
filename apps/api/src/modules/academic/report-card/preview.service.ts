import type { PrismaClient } from "@prisma/client";
import type { AuthState } from "../../../lib/auth-state.ts";
import type { RequestMeta } from "../../../lib/tenant.ts";
import { getHomeroomReportPrep, readHomeroomPrep } from "./report-card.service.ts";
import { buildReportPreview, type ReportPreviewDto } from "./preview.ts";
import type { PrintSection } from "./print-readiness.ts";
import type { HomeroomReportPrepDto } from "./types.ts";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export async function getHomeroomReportPreview(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  homeroomId: string | undefined,
  meta: RequestMeta,
) {
  const prepared = await getHomeroomReportPrep(prisma, auth, schoolId, homeroomId, meta, "REPORT_PREVIEW_READ");
  return { homerooms: prepared.homerooms, preview: prepared.prep ? await withOfficialAvailability(prisma, schoolId, await enrichPrep(prisma, schoolId, prepared.prep)) : null };
}

async function withOfficialAvailability(prisma: PrismaClient, schoolId: string, preview: NonNullable<ReportPreviewDto["preview"]>) {
  const homeroom = await prisma.homeroomAssignment.findFirst({
    where: { id: preview.homeroomId, schoolId },
    select: { academicPeriodId: true },
  });
  const workflows = homeroom
    ? await prisma.reportCardWorkflow.findMany({
        where: {
          schoolId,
          academicPeriodId: homeroom.academicPeriodId,
          status: "DISAHKAN",
          activeSnapshotId: { not: null },
          studentId: { in: preview.students.map((student) => student.studentId) },
        },
        select: { studentId: true, activeSnapshot: { select: { version: true, endorsedAt: true } } },
      })
    : [];
  const official = new Map<string, { version: number; endorsedAt: string }>();
  for (const item of workflows) {
    if (item.activeSnapshot) official.set(item.studentId, { version: item.activeSnapshot.version, endorsedAt: item.activeSnapshot.endorsedAt.toISOString() });
  }
  return {
    ...preview,
    academicPeriodId: homeroom?.academicPeriodId ?? null,
    students: preview.students.map((student) => ({ ...student, official: official.get(student.studentId) ?? null })),
  };
}

export async function readEnrichedHomeroomPreview(prisma: PrismaClient, schoolId: string, homeroomId: string) {
  const prep = await readHomeroomPrep(prisma, schoolId, homeroomId);
  if (!prep) return null;
  return enrichPrep(prisma, schoolId, prep);
}

async function enrichPrep(prisma: PrismaClient, schoolId: string, prep: NonNullable<HomeroomReportPrepDto["prep"]>) {
  const homeroom = await prisma.homeroomAssignment.findFirst({
    where: { id: prep.homeroomId, schoolId },
    select: { academicPeriodId: true, academicPeriod: { select: { reportDate: true } } },
  });
  const studentIds = prep.students.map((student) => student.studentId);
  const activities = homeroom
    ? await prisma.studentReportActivity.findMany({
        where: { schoolId, academicPeriodId: homeroom.academicPeriodId, studentId: { in: studentIds } },
        select: { studentId: true, pklText: true, extracurricularText: true },
      })
    : [];
  const endorsed = homeroom
    ? await prisma.reportCardWorkflow.findMany({
        where: {
          schoolId,
          academicPeriodId: homeroom.academicPeriodId,
          status: "DISAHKAN",
          activeSnapshotId: { not: null },
          studentId: { in: studentIds },
        },
        select: { studentId: true, activeSnapshot: { select: { payload: true } } },
      })
    : [];
  const endorsedPkl = new Map(endorsed.map((item) => [item.studentId, snapshotPkl(item.activeSnapshot?.payload)]));
  const placementPkl = homeroom
    ? await internshipPklByStudent(prisma, schoolId, homeroom.academicPeriodId, studentIds, new Set(endorsedPkl.keys()))
    : new Map<string, string>();
  const reportDate = formatDate(homeroom?.academicPeriod.reportDate ?? null);
  const byStudent = new Map(activities.map((item) => [item.studentId, item]));
  const sections = new Map<string, PrintSection[]>(studentIds.map((studentId) => {
    const activity = byStudent.get(studentId);
    const pkl = endorsedPkl.has(studentId)
      ? endorsedPkl.get(studentId)
      : activity?.pklText?.trim() || placementPkl.get(studentId) || null;
    return [studentId, [
      sourced("pkl", "PKL", pkl),
      sourced("extracurricular", "Ekstrakurikuler", activity?.extracurricularText),
      sourced("reportDate", "Tanggal rapor", reportDate),
    ]];
  }));
  return buildReportPreview(prep, sections);
}

export async function internshipPklByStudent(
  prisma: PrismaClient,
  schoolId: string,
  academicPeriodId: string,
  studentIds: string[],
  endorsedStudentIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const eligible = studentIds.filter((studentId) => !endorsedStudentIds.has(studentId));
  if (eligible.length === 0) return new Map();
  const period = await prisma.academicPeriod.findFirst({
    where: { id: academicPeriodId, schoolId },
    select: { startDate: true, endDate: true },
  });
  if (!period) return new Map();
  const placements = await prisma.internshipPlacement.findMany({
    where: {
      schoolId,
      studentId: { in: eligible },
      status: { in: ["AKTIF", "SELESAI"] },
      startDate: { lte: period.endDate },
      endDate: { gte: period.startDate },
    },
    orderBy: [{ studentId: "asc" }, { startDate: "asc" }],
    select: { studentId: true, companyName: true, startDate: true, endDate: true },
  });
  const grouped = new Map<string, string[]>();
  for (const placement of placements) {
    const line = `PKL di ${placement.companyName} (${formatDate(placement.startDate)}–${formatDate(placement.endDate)}).`;
    const lines = grouped.get(placement.studentId) ?? [];
    lines.push(line);
    grouped.set(placement.studentId, lines);
  }
  return new Map([...grouped].map(([studentId, lines]) => [studentId, lines.join(" ").slice(0, 2000)]));
}

function snapshotPkl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const sections = (payload as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return null;
  const section = sections.find((item) => item && typeof item === "object" && (item as { key?: unknown }).key === "pkl") as { status?: unknown; value?: unknown } | undefined;
  if (section?.status !== "SIAP" || typeof section.value !== "string") return null;
  const text = section.value.trim();
  return text || null;
}

function sourced(key: string, label: string, value: string | null | undefined): PrintSection {
  const text = value?.trim() ?? "";
  if (!text) return { key, label, status: "BELUM_TERSEDIA", value: null };
  return { key, label, status: "SIAP", value: text };
}

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return `${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}
