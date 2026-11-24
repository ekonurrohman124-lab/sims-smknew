import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.ts";
import type { AuthState } from "../../lib/auth-state.ts";
import { createSemester } from "./catalog.service.ts";
import { toDateOnly } from "./common.ts";
import { CalendarParseError, extractDocxText, extractPdfText, parseCalendarText, parseXlsxCalendar, type ParsedCalendarItem } from "./education-calendar.parse.ts";
import {
  hashFile,
  listStoredDocuments,
  newCalendarId,
  readStoredDocument,
  readStoredFile,
  writeStoredDocument,
  type CalendarDocument,
} from "./education-calendar.store.ts";
import type { RequestMeta } from "../../lib/tenant.ts";

const MAX_BYTES = 2 * 1024 * 1024;

type UploadFile = { filename: string; mimetype: string; content: Buffer };

function managed(auth: AuthState, schoolId: string): boolean {
  return auth.isSystemOwner || auth.assignments.some((assignment) => assignment.schoolId === schoolId && (assignment.roleCode === "ADMIN_SEKOLAH" || assignment.roleCode === "OPERATOR_SEKOLAH"));
}

function coordinator(auth: AuthState, schoolId: string): boolean {
  return managed(auth, schoolId) || auth.assignments.some((assignment) => assignment.schoolId === schoolId && assignment.roleCode === "WAKAKUR");
}

function reader(auth: AuthState, schoolId: string): boolean {
  return coordinator(auth, schoolId) || auth.assignments.some((assignment) => assignment.schoolId === schoolId && (assignment.roleCode === "KEPALA_SEKOLAH" || assignment.roleCode === "TU" || assignment.roleCode === "GURU_MAPEL" || assignment.roleCode === "WALI_KELAS"));
}

function assertManage(auth: AuthState, schoolId: string): void {
  if (!managed(auth, schoolId)) throw new AppError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk mengubah kalender pendidikan.");
}

function visible(auth: AuthState, schoolId: string, document: CalendarDocument): boolean {
  if (!reader(auth, schoolId)) return false;
  if (document.status === "PUBLISHED") return true;
  return coordinator(auth, schoolId);
}

function validateFile(file: UploadFile): "docx" | "pdf" | "xlsx" {
  const name = file.filename.toLowerCase();
  const pdf = name.endsWith(".pdf");
  const docx = name.endsWith(".docx");
  const xlsx = name.endsWith(".xlsx");
  if (!pdf && !docx && !xlsx) throw new AppError(400, "VALIDATION_ERROR", "Berkas harus berekstensi DOCX, PDF, atau XLSX.");
  const mimeOk = pdf
    ? file.mimetype === "application/pdf"
    : docx
      ? file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (!mimeOk) throw new AppError(400, "VALIDATION_ERROR", "Jenis MIME berkas tidak sesuai dengan ekstensinya.");
  if (file.content.length === 0 || file.content.length > MAX_BYTES) throw new AppError(400, "VALIDATION_ERROR", "Ukuran berkas harus antara 1 byte dan 2 MB.");
  const pdfMagic = file.content.subarray(0, 5).toString("latin1") === "%PDF-";
  const zipMagic = file.content[0] === 0x50 && file.content[1] === 0x4b;
  if (pdf && !pdfMagic) throw new AppError(400, "VALIDATION_ERROR", "Isi berkas bukan PDF.");
  if ((docx || xlsx) && !zipMagic) throw new AppError(400, "VALIDATION_ERROR", "Isi berkas tidak sesuai dengan format dokumen.");
  if (pdf) return "pdf";
  if (docx) return "docx";
  return "xlsx";
}

function toPreview(document: CalendarDocument, duplicate = false) {
  return { document, duplicate, academicChanges: 0 };
}

export async function listEducationCalendar(prisma: PrismaClient, auth: AuthState, schoolId: string) {
  if (!reader(auth, schoolId)) throw new AppError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk melihat kalender pendidikan.");
  const documents = await listStoredDocuments(schoolId);
  return { documents: documents.filter((document) => visible(auth, schoolId, document)).map((document) => toPreview(document).document) };
}

export async function uploadEducationCalendar(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  academicYearId: string,
  file: UploadFile,
) {
  assertManage(auth, schoolId);
  const kind = validateFile(file);
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId }, select: { id: true, name: true } });
  if (!year) throw new AppError(404, "NOT_FOUND", "Tahun pelajaran tidak ditemukan di sekolah ini.");
  const school = await prisma.school.findFirst({ where: { id: schoolId }, select: { npsn: true } });
  let text = "";
  let parsed = null as Awaited<ReturnType<typeof parseXlsxCalendar>> | null;
  try {
    if (kind === "xlsx") parsed = await parseXlsxCalendar(file.content);
    else text = kind === "pdf" ? extractPdfText(file.content) : extractDocxText(file.content);
  } catch (error) {
    if (error instanceof CalendarParseError) throw new AppError(400, "VALIDATION_ERROR", error.message);
    throw error;
  }
  parsed ??= parseCalendarText(text, kind === "pdf" ? "PDF" : "DOCX");
  if (parsed.npsn && parsed.npsn !== school?.npsn) {
    throw new AppError(422, "VALIDATION_ERROR", "NPSN pada dokumen tidak sama dengan sekolah yang dipilih. Dokumen tidak disimpan.");
  }
  const sha256 = hashFile(file.content);
  const existing = (await listStoredDocuments(schoolId)).find((document) => document.academicYearId === year.id && document.sha256 === sha256);
  if (existing) return { ...toPreview(existing, true), integration: await semesterIntegration(prisma, existing) };
  const yearStatus = !parsed.academicYearName ? "TIDAK_TERCANTUM" : parsed.academicYearName === year.name ? "COCOK" : "BERBEDA";
  const now = new Date().toISOString();
  const document: CalendarDocument = {
    id: newCalendarId(),
    schoolId,
    academicYearId: year.id,
    academicYearName: year.name,
    originalName: file.filename.slice(0, 180),
    mimeType: file.mimetype,
    sha256,
    byteSize: file.content.length,
    decisionNumber: parsed.decisionNumber,
    extractedYear: parsed.academicYearName,
    extractedNpsn: parsed.npsn,
    npsnStatus: parsed.npsn ? "COCOK" : "TIDAK_TERCANTUM",
    yearStatus,
    status: "DRAFT",
    warning: yearStatus === "BERBEDA" ? "Tahun pelajaran pada dokumen berbeda dengan tahun yang dipilih." : parsed.items.some((item) => item.verification === "PERLU_VERIFIKASI") ? "Sebagian tanggal perlu verifikasi." : null,
    uploadedById: auth.userId,
    createdAt: now,
    updatedAt: now,
    items: parsed.items.map((item) => ({ ...item, id: newCalendarId() })),
    notes: [],
  };
  await writeStoredDocument(schoolId, document, file.content);
  return { ...toPreview(document), integration: await semesterIntegration(prisma, document) };
}

export async function educationCalendarDetail(prisma: PrismaClient, auth: AuthState, schoolId: string, id: string) {
  const document = await readStoredDocument(schoolId, id);
  if (!document || !visible(auth, schoolId, document)) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  return { document, integration: coordinator(auth, schoolId) ? await semesterIntegration(prisma, document) : null };
}

export async function correctEducationCalendarItem(
  auth: AuthState,
  schoolId: string,
  documentId: string,
  itemId: string,
  input: Pick<ParsedCalendarItem, "title" | "category" | "semesterKind" | "eventDate" | "endDate" | "verification">,
) {
  assertManage(auth, schoolId);
  const document = await readStoredDocument(schoolId, documentId);
  if (!document) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  if (document.status === "PUBLISHED") throw new AppError(409, "IN_USE", "Kalender yang sudah disahkan tidak diubah dari pratinjau.");
  const item = document.items.find((entry) => entry.id === itemId);
  if (!item) throw new AppError(404, "NOT_FOUND", "Kegiatan tidak ditemukan.");
  if (input.endDate && input.eventDate && input.endDate < input.eventDate) throw new AppError(400, "VALIDATION_ERROR", "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  item.title = input.title;
  item.category = input.category;
  item.semesterKind = input.category === "SEMESTER" ? input.semesterKind : null;
  item.eventDate = input.eventDate;
  item.endDate = input.endDate;
  item.verification = input.verification;
  item.warning = input.verification === "PERLU_VERIFIKASI" ? item.warning ?? "Dikoreksi dan masih perlu verifikasi." : null;
  document.updatedAt = new Date().toISOString();
  await writeStoredDocument(schoolId, document);
  return { document };
}

export async function addEducationCalendarNote(auth: AuthState, schoolId: string, documentId: string, body: string, authorName: string) {
  if (!coordinator(auth, schoolId)) throw new AppError(403, "FORBIDDEN", "Masukan kalender hanya dapat diberikan oleh wakil kurikulum atau admin sekolah.");
  const document = await readStoredDocument(schoolId, documentId);
  if (!document || !visible(auth, schoolId, document)) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  document.notes.push({ id: newCalendarId(), authorId: auth.userId, authorName, body, createdAt: new Date().toISOString() });
  document.updatedAt = new Date().toISOString();
  await writeStoredDocument(schoolId, document);
  return { document };
}

export async function publishEducationCalendar(auth: AuthState, schoolId: string, documentId: string) {
  assertManage(auth, schoolId);
  const document = await readStoredDocument(schoolId, documentId);
  if (!document) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  if (document.yearStatus === "BERBEDA") throw new AppError(409, "IN_USE", "Tahun pelajaran pada dokumen belum sesuai. Kalender tidak disahkan.");
  if (document.items.some((item) => item.verification === "PERLU_VERIFIKASI")) {
    throw new AppError(409, "IN_USE", "Masih ada tanggal yang perlu verifikasi. Kalender tidak disahkan dan semester tidak diubah.");
  }
  document.status = "PUBLISHED";
  document.updatedAt = new Date().toISOString();
  await writeStoredDocument(schoolId, document);
  return { document };
}

async function semesterIntegration(prisma: PrismaClient, document: CalendarDocument) {
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId: document.schoolId, academicYearId: document.academicYearId },
    select: { id: true, name: true, semesterKind: true, startDate: true, endDate: true, isActive: true },
  });
  return (["GANJIL", "GENAP"] as const).map((semesterKind) => {
    const items = document.items.filter((item) => item.category === "SEMESTER" && item.semesterKind === semesterKind);
    const existing = periods.find((period) => period.semesterKind === semesterKind);
    if (items.length === 0 || items.some((item) => item.verification !== "TERVERIFIKASI" || !item.eventDate || !item.endDate)) {
      return { semesterKind, action: "PERLU_KEPUTUSAN" as const, reason: "Tanggal administratif semester tidak tersedia atau masih perlu verifikasi. Admin sekolah yang memutuskan.", existingId: existing?.id ?? null };
    }
    const startDate = items[0]?.eventDate ?? null;
    const endDate = items[0]?.endDate ?? null;
    if (!startDate || !endDate || items.some((item) => item.eventDate !== startDate || item.endDate !== endDate)) {
      return { semesterKind, action: "PERLU_KEPUTUSAN" as const, reason: "Dokumen memuat lebih dari satu rentang untuk jenis semester yang sama.", existingId: existing?.id ?? null };
    }
    if (!existing) return { semesterKind, action: "CREATE" as const, startDate, endDate, isActive: false, existingId: null };
    const storedStart = toDateOnly(existing.startDate);
    const storedEnd = toDateOnly(existing.endDate);
    if (storedStart === startDate && storedEnd === endDate) return { semesterKind, action: "REUSE" as const, existingId: existing.id, startDate, endDate };
    return {
      semesterKind,
      action: "PERLU_KEPUTUSAN" as const,
      reason: "Semester sudah ada dengan tanggal berbeda. Tanggal dan status yang tersimpan tidak diubah.",
      existingId: existing.id,
      storedStart,
      storedEnd,
      startDate,
      endDate,
    };
  });
}

export async function applyEducationCalendar(
  prisma: PrismaClient,
  auth: AuthState,
  schoolId: string,
  documentId: string,
  creates: Array<"GANJIL" | "GENAP">,
  meta: RequestMeta,
) {
  assertManage(auth, schoolId);
  const document = await readStoredDocument(schoolId, documentId);
  if (!document) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  const integration = await semesterIntegration(prisma, document);
  const selected = creates.map((kind) => integration.find((item) => item.semesterKind === kind));
  if (selected.some((item) => !item || item.action !== "CREATE" || !("startDate" in item))) {
    throw new AppError(409, "IN_USE", "Semester hanya ditambahkan bila tanggal administratif sudah terverifikasi dan jenis itu belum ada. Data semester yang ada tidak diubah.");
  }
  const created = [];
  for (const item of selected) {
    if (!item || item.action !== "CREATE" || !item.startDate || !item.endDate) continue;
    created.push(await createSemester(prisma, auth, schoolId, {
      academicYearId: document.academicYearId,
      name: `Semester ${item.semesterKind === "GANJIL" ? "Ganjil" : "Genap"} ${document.academicYearName}`.slice(0, 40),
      semesterKind: item.semesterKind,
      startDate: item.startDate,
      endDate: item.endDate,
      isActive: false,
    }, meta));
  }
  return { created, integration: await semesterIntegration(prisma, document) };
}

export async function educationCalendarFile(auth: AuthState, schoolId: string, id: string) {
  const document = await readStoredDocument(schoolId, id);
  if (!document || !visible(auth, schoolId, document)) throw new AppError(404, "NOT_FOUND", "Dokumen kalender tidak ditemukan.");
  return { document, content: await readStoredFile(schoolId, id) };
}
