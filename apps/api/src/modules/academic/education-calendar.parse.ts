import ExcelJS from "exceljs";
import { inflateRawSync, inflateSync } from "node:zlib";

export class CalendarParseError extends Error {}

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};
const WEEKDAYS = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];
const MONTH_PATTERN = Object.keys(MONTHS).join("|");

export type CalendarCategory = "KEGIATAN" | "LIBUR" | "ASESMEN" | "RAPOR" | "SEMESTER";
export type CalendarVerification = "TERVERIFIKASI" | "PERLU_VERIFIKASI";

export type ParsedCalendarItem = {
  dateText: string;
  eventDate: string | null;
  endDate: string | null;
  title: string;
  category: CalendarCategory;
  semesterKind: "GANJIL" | "GENAP" | null;
  verification: CalendarVerification;
  excerpt: string;
  warning: string | null;
  source: string;
};

export type ParsedCalendar = {
  decisionNumber: string | null;
  academicYearName: string | null;
  npsn: string | null;
  items: ParsedCalendarItem[];
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function weekdayName(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()] ?? "minggu";
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function categoryOf(text: string): CalendarCategory {
  const value = text.toLowerCase();
  if (/rapor/.test(value)) return "RAPOR";
  if (/libur|cuti bersama|hari raya|tahun baru|nyepi|waisak|idul|imlek|maulid|isra|natal|hari buruh|kenaikan yesus|wafat yesus/.test(value)) return "LIBUR";
  if (/asesmen|penilaian|ujian|\bpas\b|\bpat\b|sumatif|\bsts\b|\bsas\b/.test(value)) return "ASESMEN";
  if (/semester/.test(value)) return "SEMESTER";
  return "KEGIATAN";
}

function semesterKindOf(text: string): "GANJIL" | "GENAP" | null {
  const value = text.toLowerCase();
  if (/ganjil|gasal/.test(value)) return "GANJIL";
  if (/genap/.test(value)) return "GENAP";
  return null;
}

type FoundDate = { iso: string; index: number; raw: string };

function fullDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  const named = new RegExp(`(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})`, "gi");
  for (const match of text.matchAll(named)) {
    const day = Number(match[1]);
    const month = MONTHS[(match[2] ?? "").toLowerCase()];
    const year = Number(match[3]);
    const iso = month ? isoDate(year, month, day) : null;
    if (iso && match.index !== undefined) found.push({ iso, index: match.index, raw: match[0] });
  }
  const numeric = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/g;
  for (const match of text.matchAll(numeric)) {
    const iso = isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
    if (iso && match.index !== undefined) found.push({ iso, index: match.index, raw: match[0] });
  }
  return found.sort((left, right) => left.index - right.index);
}

function hasPartialDate(text: string): boolean {
  return new RegExp(`\\d{1,2}\\s+(?:${MONTH_PATTERN})(?!\\s+\\d{4})`, "i").test(text);
}

function leadingWeekday(text: string, index: number): string | null {
  const before = text.slice(Math.max(0, index - 16), index);
  const named = /(jum['’]?at|senin|selasa|rabu|kamis|sabtu|minggu)\s*$/i.exec(before);
  return named?.[1]?.toLowerCase().replace(/['’]/g, "") ?? null;
}

type MonthContext = { month: number; year: number; label: string };

function singleYear(text: string): number | null {
  const years = [...new Set([...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])))];
  return years.length === 1 ? years[0] ?? null : null;
}

function yearFor(month: number, explicit: number | null, context: MonthContext | null): { year: number | null; borrowed: boolean } {
  if (explicit) return { year: explicit, borrowed: false };
  if (!context) return { year: null, borrowed: false };
  if (context.month === month) return { year: context.year, borrowed: true };
  return { year: month < context.month ? context.year + 1 : context.year, borrowed: true };
}

function looseDates(text: string, context: MonthContext | null): { eventDate: string | null; endDate: string | null; verification: CalendarVerification; warning: string | null } | null {
  const cross = new RegExp(`(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\s*(?:-|–|—|s\\.?\\s?d\\.?)\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`, "i").exec(text);
  const same = new RegExp(`(\\d{1,2})\\s*(?:-|–|—|s\\.?\\s?d\\.?)\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`, "i").exec(text);
  const one = new RegExp(`(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`, "i").exec(text);
  if (!cross && !same && !one) return null;
  const explicit = singleYear(text);
  if (cross) {
    const startMonth = MONTHS[(cross[2] ?? "").toLowerCase()] ?? 0;
    const endMonth = MONTHS[(cross[5] ?? "").toLowerCase()] ?? 0;
    const startYear = yearFor(startMonth, cross[3] ? Number(cross[3]) : explicit, context);
    const endYear = yearFor(endMonth, cross[6] ? Number(cross[6]) : explicit, context);
    const eventDate = startYear.year ? isoDate(startYear.year, startMonth, Number(cross[1])) : null;
    const endDate = endYear.year ? isoDate(endYear.year, endMonth, Number(cross[4])) : null;
    const borrowed = !cross[3] || !cross[6];
    return {
      eventDate,
      endDate,
      verification: eventDate && endDate && !borrowed ? "TERVERIFIKASI" : "PERLU_VERIFIKASI",
      warning: eventDate && endDate && !borrowed ? null : "Tahun pada salah satu ujung rentang tidak tertulis di kalimat yang sama.",
    };
  }
  if (same) {
    const month = MONTHS[(same[3] ?? "").toLowerCase()] ?? 0;
    const found = yearFor(month, same[4] ? Number(same[4]) : explicit, context);
    const eventDate = found.year ? isoDate(found.year, month, Number(same[1])) : null;
    const endDate = found.year ? isoDate(found.year, month, Number(same[2])) : null;
    const outside = context !== null && context.month !== month;
    return {
      eventDate,
      endDate,
      verification: eventDate && endDate && !outside ? "TERVERIFIKASI" : "PERLU_VERIFIKASI",
      warning: eventDate && endDate && !outside ? null : "Tahun atau bulan rentang perlu dicocokkan dengan judul bagian.",
    };
  }
  const month = MONTHS[(one?.[2] ?? "").toLowerCase()] ?? 0;
  const found = yearFor(month, one?.[3] ? Number(one[3]) : explicit, context);
  const matched = Boolean(one?.[3]) || Boolean(explicit) || context?.month === month;
  const eventDate = found.year ? isoDate(found.year, month, Number(one?.[1])) : null;
  return {
    eventDate,
    endDate: null,
    verification: eventDate && matched ? "TERVERIFIKASI" : "PERLU_VERIFIKASI",
    warning: eventDate && matched ? null : "Tahun tidak tertulis pada kalimat kegiatan.",
  };
}

function itemFromParagraph(paragraph: string, context: MonthContext | null = null, source = "dokumen"): ParsedCalendarItem | null {
  const text = clean(paragraph);
  if (text.length < 3 || /^kalender pendidikan\b/i.test(text)) return null;
  const truncatedRange = /^(?:s\.?\s?d\.?|[-–—])\s*\d/i.test(text);
  const dates = fullDates(text);
  const loose = dates.length === 0 ? looseDates(text, context) : null;
  const partial = dates.length === 0 && (loose !== null || hasPartialDate(text) || /asesmen|libur|rapor|semester|ujian|perkiraan|mpls/i.test(text));
  if (dates.length === 0 && !partial) return null;
  const category = categoryOf(text);
  const semesterKind = category === "SEMESTER" ? semesterKindOf(text) : null;
  let eventDate: string | null = loose?.eventDate ?? null;
  let endDate: string | null = loose?.endDate ?? null;
  let verification: CalendarVerification = loose?.verification ?? "TERVERIFIKASI";
  let warning: string | null = loose?.warning ?? null;
  if (dates.length >= 2) {
    const between = text.slice((dates[0]?.index ?? 0) + (dates[0]?.raw.length ?? 0), dates[1]?.index ?? text.length).toLowerCase();
    if (/atau/.test(between)) {
      verification = "PERLU_VERIFIKASI";
      warning = "Paragraf memuat lebih dari satu tanggal tanpa rentang yang tunggal.";
    } else if (/sampai|hingga|s\.?\s?d\.?|s\/d|–|—|-/.test(between)) {
      eventDate = dates[0]?.iso ?? null;
      endDate = dates[1]?.iso ?? null;
      if (!eventDate || !endDate || endDate < eventDate) {
        verification = "PERLU_VERIFIKASI";
        warning = "Rentang tanggal tidak dapat dipastikan.";
        eventDate = null;
        endDate = null;
      }
    } else {
      verification = "PERLU_VERIFIKASI";
      warning = "Paragraf memuat lebih dari satu tanggal tanpa rentang yang tunggal.";
    }
  } else if (dates.length === 1) {
    eventDate = dates[0]?.iso ?? null;
  } else if (!loose) {
    verification = "PERLU_VERIFIKASI";
    warning = "Tanggal belum lengkap karena tahun atau hari tidak tercantum.";
  }
  const dated = dates.find((item) => item.iso === eventDate);
  if (eventDate && dated) {
    const writtenDay = leadingWeekday(text, dated.index);
    if (writtenDay && writtenDay !== weekdayName(eventDate)) {
      verification = "PERLU_VERIFIKASI";
      warning = `Hari yang tertulis tidak sesuai dengan tanggal ${eventDate}.`;
    }
  }
  if (category === "SEMESTER" && (!eventDate || !endDate || !semesterKind)) {
    verification = "PERLU_VERIFIKASI";
    warning = warning ?? "Tanggal administratif semester belum lengkap.";
  }
  if (/perkiraan/i.test(text)) {
    verification = "PERLU_VERIFIKASI";
    warning = warning ?? "Kegiatan ini tertulis sebagai perkiraan.";
  }
  if (truncatedRange) {
    eventDate = null;
    endDate = null;
    verification = "PERLU_VERIFIKASI";
    warning = "Awal rentang tidak utuh pada bagian dokumen ini.";
  }
  return {
    dateText: text.slice(0, 240),
    eventDate,
    endDate,
    title: text.slice(0, 180),
    category,
    semesterKind,
    verification,
    excerpt: text.slice(0, 240),
    warning,
    source: (context ? `${source} / ${context.label}` : source).slice(0, 180),
  };
}

function splitLegend(paragraph: string): string[] {
  const pattern = new RegExp(
    `(?<=\\s)(?<![-–—]\\s)(?<!s\\.d\\.\\s)(?<!s\\.d\\s)(?<!sd\\s)(?=\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s*:|\\d{1,2}\\s*(?:[-–—]|s\\.?\\s?d\\.?)\\s*\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s*:|\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s*(?:[-–—]|s\\.?\\s?d\\.?)\\s*\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s*:)`,
    "i",
  );
  const pieces = paragraph.split(pattern).map((piece) => piece.trim()).filter(Boolean);
  return pieces.length > 0 ? pieces : [paragraph];
}

export function parseCalendarText(source: string, origin = "dokumen"): ParsedCalendar {
  const text = source.replace(/\u0000/g, " ");
  const decision = /(?:nomor|no\.)\s*[:.]?\s*([0-9][0-9a-z./-]{4,80})/i.exec(text);
  const year = /(20\d{2})\s*[/–-]\s*(20\d{2})/.exec(text);
  const npsn = /npsn\s*[:.]?\s*(\d{8})/i.exec(text);
  const items: ParsedCalendarItem[] = [];
  let context: MonthContext | null = null;
  let pending = "";
  const pushParagraph = (value: string) => {
    for (const piece of splitLegend(value)) {
      const item = itemFromParagraph(piece, context, origin);
      if (item) items.push(item);
    }
  };
  for (const raw of text.split(/\n+/)) {
    let paragraph = clean(raw);
    if (!paragraph) continue;
    const heading = new RegExp(`^(${MONTH_PATTERN})\\s+(20\\d{2})$`, "i").exec(paragraph);
    if (heading?.[1] && heading[2]) {
      if (pending) pushParagraph(pending);
      pending = "";
      context = { month: MONTHS[heading[1].toLowerCase()] ?? 0, year: Number(heading[2]), label: paragraph };
      continue;
    }
    if (pending) {
      const continues = /[A-Za-z]/.test(paragraph) && !/^\d/.test(paragraph);
      paragraph = continues ? `${pending} ${paragraph}` : paragraph;
      if (!continues) pushParagraph(pending);
      pending = "";
    }
    if (paragraph.endsWith(":")) {
      pending = paragraph;
      continue;
    }
    pushParagraph(paragraph);
  }
  if (pending) pushParagraph(pending);
  return {
    decisionNumber: decision?.[1] ?? null,
    academicYearName: year ? `${year[1]}/${year[2]}` : null,
    npsn: npsn?.[1] ?? null,
    items: uniqueItems(items),
  };
}

function zipSlice(buffer: Buffer, localOffset: number, method: number, size: number): Buffer {
  if (localOffset < 0 || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new CalendarParseError("Berkas DOCX tidak dapat dibaca.");
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + size;
  if (size === 0 || end > buffer.length) throw new CalendarParseError("Berkas DOCX tidak dapat dibaca.");
  const slice = buffer.subarray(start, end);
  if (method === 0) return slice;
  if (method === 8) return inflateRawSync(slice);
  throw new CalendarParseError("Berkas DOCX tidak dapat dibaca.");
}

function unzipEntry(buffer: Buffer, entryName: string, required = true): string | null {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65535); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd >= 0) {
    const count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (offset === 0xffffffff) throw new CalendarParseError("Berkas DOCX tidak dapat dibaca.");
    for (let entry = 0; entry < count; entry += 1) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new CalendarParseError("Berkas DOCX tidak dapat dibaca.");
      const method = buffer.readUInt16LE(offset + 10);
      const size = buffer.readUInt32LE(offset + 20);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      if (name === entryName) return zipSlice(buffer, localOffset, method, size).toString("utf8");
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (!required) return null;
    throw new CalendarParseError("Dokumen DOCX tidak berisi teks.");
  }
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (name === entryName) return zipSlice(buffer, offset, method, size).toString("utf8");
    if (size === 0) break;
    offset += 30 + nameLength + extraLength + size;
  }
  if (!required) return null;
  throw new CalendarParseError("Dokumen DOCX tidak berisi teks.");
}

function decimalListStarts(numberingXml: string): Map<string, number> {
  const abstracts = new Map<string, number>();
  for (const block of numberingXml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = /w:abstractNumId="(\d+)"/.exec(block)?.[1];
    const level = /<w:lvl\b[^>]*w:ilvl="0"[\s\S]*?<\/w:lvl>/.exec(block)?.[0] ?? "";
    const format = /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(level)?.[1];
    const start = Number(/<w:start\b[^>]*w:val="(\d+)"/.exec(level)?.[1] ?? "1");
    if (id && format === "decimal") abstracts.set(id, start);
  }
  const lists = new Map<string, number>();
  for (const block of numberingXml.match(/<w:num\b[\s\S]*?<\/w:num>/g) ?? []) {
    const id = /w:numId="(\d+)"/.exec(block)?.[1];
    const abstractId = /<w:abstractNumId\b[^>]*w:val="(\d+)"/.exec(block)?.[1];
    if (!id || !abstractId || !abstracts.has(abstractId)) continue;
    const override = /<w:startOverride\b[^>]*w:val="(\d+)"/.exec(block)?.[1];
    lists.set(id, override ? Number(override) : abstracts.get(abstractId) ?? 1);
  }
  return lists;
}

function paragraphText(paragraph: string): string {
  const withBreaks = paragraph.replace(/<w:tab[^>]*\/>/g, " ").replace(/<w:br[^>]*\/>/g, "\n");
  return clean([...withBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1] ?? "").join("")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"));
}

export function extractDocxText(buffer: Buffer): string {
  const xml = unzipEntry(buffer, "word/document.xml");
  if (!xml) throw new CalendarParseError("Dokumen DOCX tidak berisi teks.");
  const numbering = unzipEntry(buffer, "word/numbering.xml", false) ?? "";
  const starts = numbering ? decimalListStarts(numbering) : new Map<string, number>();
  const counters = new Map<string, number>();
  const seenNumbered = new Set<string>();
  const lines: string[] = [];
  for (const paragraph of xml.split(/<w:p[ >]/).slice(1)) {
    const text = paragraphText(paragraph);
    if (!text) continue;
    const numId = /<w:numId\b[^>]*w:val="(\d+)"/.exec(paragraph)?.[1];
    const level = /<w:ilvl\b[^>]*w:val="(\d+)"/.exec(paragraph)?.[1] ?? "0";
    if (numId && level === "0" && starts.has(numId)) {
      const current = counters.get(numId) ?? starts.get(numId) ?? 1;
      counters.set(numId, current + 1);
      if (seenNumbered.has(text)) continue;
      seenNumbered.add(text);
      lines.push(`${current} ${text}`);
      continue;
    }
    lines.push(text);
  }
  const joined = lines.join("\n");
  if (clean(joined).length < 3) throw new CalendarParseError("Dokumen DOCX tidak berisi teks.");
  return joined;
}

function pdfLiteral(value: string): string {
  return value.replace(/\\([nrtbf()\\])/g, (_, mark: string) => {
    if (mark === "n") return "\n";
    if (mark === "r") return "\r";
    if (mark === "t") return "\t";
    return mark;
  });
}

function literalsOf(value: string): string {
  return [...value.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((match) => pdfLiteral(match[0].slice(1, -1))).join(" ");
}

export function extractPdfText(buffer: Buffer): string {
  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf("stream", cursor);
    if (start < 0) break;
    let dataStart = start + 6;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const end = buffer.indexOf("endstream", dataStart);
    if (end < 0) break;
    let data = buffer.subarray(dataStart, end);
    if (data.at(-1) === 0x0a) data = data.subarray(0, -1);
    if (data.at(-1) === 0x0d) data = data.subarray(0, -1);
    const dictAt = buffer.lastIndexOf("<<", start);
    const dict = dictAt >= 0 ? buffer.subarray(dictAt, start).toString("latin1") : "";
    if (/DCTDecode|JPXDecode|CCITTFaxDecode/.test(dict)) {
      cursor = end + 9;
      continue;
    }
    if (/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data);
      } catch {
        data = inflateRawSync(data);
      }
    }
    pieces.push(literalsOf(data.toString("latin1")));
    cursor = end + 9;
  }
  const text = pieces.join("\n").trim() || literalsOf(buffer.toString("latin1")).trim();
  if (text.length < 3) throw new CalendarParseError("PDF tidak berisi teks yang dapat dibaca. Berkas pindai tidak didukung.");
  return text;
}

function uniqueItems(items: ParsedCalendarItem[]): ParsedCalendarItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}|${item.eventDate ?? ""}|${item.endDate ?? ""}|${item.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function columnNumber(letters: string): number {
  return [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function columnLetters(value: number): string {
  let current = value;
  let letters = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }
  return letters;
}

function cellAddress(column: number, row: number): string {
  return `${columnLetters(column)}${row}`;
}

function excelText(value: ExcelJS.CellValue): string {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return "";
  if (value && typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return clean(value.richText.map((part) => part.text).join(""));
  }
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return clean(value.text);
  return "";
}

function excelDay(value: ExcelJS.CellValue): string | null {
  if (!(value instanceof Date)) return null;
  const iso = value.toISOString();
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
  return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

type MonthBand = { startColumn: number; endColumn: number; row: number; context: MonthContext };

export async function parseXlsxCalendar(content: Buffer): Promise<ParsedCalendar> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(content as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  } catch {
    throw new CalendarParseError("Berkas XLSX tidak dapat dibaca.");
  }
  const items: ParsedCalendarItem[] = [];
  const prose: string[] = [];
  for (const sheet of workbook.worksheets) {
    const merges = sheet.model.merges ?? [];
    const hidden = new Set<string>();
    const bands: MonthBand[] = [];
    for (const merge of merges) {
      const [start, end] = merge.split(":");
      if (!start || !end) continue;
      const startMatch = /^([A-Z]+)(\d+)$/.exec(start);
      const endMatch = /^([A-Z]+)(\d+)$/.exec(end);
      if (!startMatch?.[1] || !startMatch[2] || !endMatch?.[1] || !endMatch[2]) continue;
      const startColumn = columnNumber(startMatch[1]);
      const endColumn = columnNumber(endMatch[1]);
      const startRow = Number(startMatch[2]);
      const endRow = Number(endMatch[2]);
      for (let row = startRow; row <= endRow; row += 1) {
        for (let column = startColumn; column <= endColumn; column += 1) {
          const address = cellAddress(column, row);
          if (address !== start) hidden.add(address);
        }
      }
    }
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumberValue) => {
        if (hidden.has(cell.address)) return;
        const day = excelDay(cell.value);
        if (day?.endsWith("-01")) {
          const [yearText, monthText] = day.split("-");
          const merge = merges.find((item) => item.startsWith(`${cell.address}:`));
          const endColumn = merge ? columnNumber(/^([A-Z]+)/.exec(merge.split(":")[1] ?? "")?.[1] ?? columnLetters(columnNumberValue)) : columnNumberValue;
          const label = `${["", ...Object.keys(MONTHS)][Number(monthText)] ?? ""} ${yearText}`.trim();
          const pretty = label.charAt(0).toUpperCase() + label.slice(1);
          bands.push({
            startColumn: columnNumberValue,
            endColumn,
            row: rowNumber,
            context: { month: Number(monthText), year: Number(yearText), label: pretty },
          });
        }
        const text = excelText(cell.value);
        if (text.length > 8) prose.push(text);
      });
    });
    const pending = new Map<number, { row: number; text: string; address: string }>();
    const collected: Array<{ column: number; row: number; text: string; address: string }> = [];
    const remember = (column: number) => {
      const previous = pending.get(column);
      if (previous) collected.push({ column, ...previous });
    };
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (hidden.has(cell.address)) return;
        const text = excelText(cell.value);
        if (text.length < 3 || !/[A-Za-z]/.test(text) || /^kalender pendidikan\b/i.test(text)) return;
        const previous = pending.get(column);
        const continues = previous && rowNumber - previous.row <= 2 && (previous.text.endsWith(":") || /^[a-z]/.test(text));
        if (continues && previous) {
          previous.text = clean(`${previous.text} ${text}`);
          previous.row = rowNumber;
          return;
        }
        if (/^\d{1,2}$/.test(text)) return;
        remember(column);
        pending.set(column, { row: rowNumber, text, address: cell.address });
      });
    });
    for (const column of pending.keys()) remember(column);
    for (const note of collected) {
      const band = bands.filter((item) => item.row < note.row && item.startColumn <= note.column && note.column <= item.endColumn).sort((left, right) => right.row - left.row)[0];
      for (const piece of splitLegend(note.text)) {
        const item = itemFromParagraph(piece, band?.context ?? null, `${sheet.name}!${note.address}`);
        if (item) items.push(item);
      }
    }
  }
  if (items.length === 0 && prose.length === 0) throw new CalendarParseError("Berkas XLSX tidak berisi teks yang dapat dibaca.");
  const joined = prose.join("\n");
  const header = parseCalendarText(joined, "XLSX");
  return {
    decisionNumber: header.decisionNumber,
    academicYearName: header.academicYearName,
    npsn: header.npsn,
    items: uniqueItems(items),
  };
}
