import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCalendarItem } from "./education-calendar.parse.ts";

export type CalendarDocument = {
  id: string;
  schoolId: string;
  academicYearId: string;
  academicYearName: string;
  originalName: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  decisionNumber: string | null;
  extractedYear: string | null;
  extractedNpsn: string | null;
  npsnStatus: "COCOK" | "TIDAK_TERCANTUM";
  yearStatus: "COCOK" | "BERBEDA" | "TIDAK_TERCANTUM";
  status: "DRAFT" | "PUBLISHED";
  warning: string | null;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
  items: Array<ParsedCalendarItem & { id: string }>;
  notes: Array<{ id: string; authorId: string; authorName: string; body: string; createdAt: string }>;
};

export function calendarRoot(): string {
  return process.env.EDUCATION_CALENDAR_DIR || path.join(os.homedir(), "AppData", "Local", "sims-smk", "education-calendar");
}

function schoolDir(schoolId: string): string {
  if (!/^[\w-]+$/.test(schoolId)) throw new Error("Identitas sekolah tidak valid.");
  return path.join(calendarRoot(), schoolId);
}

function documentPath(schoolId: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Dokumen tidak valid.");
  return path.join(schoolDir(schoolId), `${id}.json`);
}

export function hashFile(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function listStoredDocuments(schoolId: string): Promise<CalendarDocument[]> {
  let names: string[] = [];
  try {
    names = await readdir(schoolDir(schoolId));
  } catch {
    return [];
  }
  const documents: CalendarDocument[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(schoolDir(schoolId), name), "utf8")) as CalendarDocument;
      if (parsed.schoolId === schoolId) documents.push(parsed);
    } catch {
      continue;
    }
  }
  return documents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function readStoredDocument(schoolId: string, id: string): Promise<CalendarDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(documentPath(schoolId, id), "utf8")) as CalendarDocument;
    return parsed.schoolId === schoolId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeStoredDocument(schoolId: string, document: CalendarDocument, content?: Buffer): Promise<void> {
  const dir = schoolDir(schoolId);
  await mkdir(dir, { recursive: true });
  if (content) await writeFile(path.join(dir, `${document.id}.bin`), content, { flag: "wx", mode: 0o600 });
  const target = documentPath(schoolId, document.id);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(document), { mode: 0o600 });
  await rename(temporary, target);
}

export async function readStoredFile(schoolId: string, id: string): Promise<Buffer> {
  return readFile(path.join(schoolDir(schoolId), `${id}.bin`));
}

export function newCalendarId(): string {
  return randomUUID();
}
