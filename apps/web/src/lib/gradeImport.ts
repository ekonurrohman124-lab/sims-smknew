import * as XLSX from "xlsx";
import type { GradeSheetDto } from "@sims/shared";

export type DetectedImportColumn = {
  key: string;
  sheetName: string;
  colIndex: number;
  label: string;
  category: "formative" | "summative" | "term";
  tpCode?: string;
  tpDescription?: string;
  field: string;
  matchedCount: number;
  values: Record<string, string>;
};

export type GradeImportStats = {
  accepted: number;
  skippedEmpty: number;
  rejectedInvalid: number;
  unmatchedNames: string[];
};

export type ParsedWorkbookResult = {
  sheetNames: string[];
  columnsBySheet: Record<string, DetectedImportColumn[]>;
  allColumns: DetectedImportColumn[];
  stats: GradeImportStats;
};

export function normalizeStudentName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseMatrixSheet(
  sheetName: string,
  matrix: string[][],
  students: GradeSheetDto["students"],
  prefixSheet: boolean,
): { columns: DetectedImportColumn[]; stats: GradeImportStats } {
  const studentByNorm = new Map<string, { id: string; name: string }>();
  for (const st of students) {
    studentByNorm.set(normalizeStudentName(st.name), { id: st.id, name: st.name });
  }

  const headerIdx = matrix.findIndex((r) =>
    r.some((cell) => /nama\s*siswa|^nama$/i.test(String(cell ?? "").trim())),
  );
  if (headerIdx < 0) return { columns: [], stats: { accepted: 0, skippedEmpty: 0, rejectedInvalid: 0, unmatchedNames: [] } };

  const nameCol = matrix[headerIdx]!.findIndex((cell) =>
    /nama\s*siswa|^nama$/i.test(String(cell ?? "").trim()),
  );
  const headerRows = matrix.slice(headerIdx, Math.min(headerIdx + 4, matrix.length));
  const maxCols = Math.max(...headerRows.map((r) => r.length), 0);

  let currentTpCode = "";
  let currentTpDesc = "";
  const tpByCol: { code: string; desc: string }[] = [];
  const topRow = headerRows[0] ?? [];
  for (let c = 0; c < maxCols; c += 1) {
    const raw = String(topRow[c] ?? "").replace(/\s+/g, " ").trim();
    const tpMatch = raw.match(/^TP\s*(\d+)/i);
    if (tpMatch) {
      currentTpCode = `TP ${tpMatch[1]}`;
      currentTpDesc = raw;
    } else if (/^KKTP|^Deskripsi|^RERATA/i.test(raw)) {
      currentTpCode = "";
      currentTpDesc = "";
    }
    tpByCol[c] = { code: currentTpCode, desc: currentTpDesc };
  }

  const candidates: Omit<DetectedImportColumn, "matchedCount" | "values">[] = [];
  for (let c = 0; c < maxCols; c += 1) {
    if (c === nameCol) continue;
    const labels = headerRows
      .map((r) => String(r[c] ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (labels.length === 0) continue;

    const topLabel = String(topRow[c] ?? "").replace(/\s+/g, " ").trim();
    const leafLabel = labels[labels.length - 1] ?? "";
    const joined = labels.join(" ").toUpperCase();
    const tpInfo = tpByCol[c];

    if (/^(NO|L\/P|KKTP|R\s*T|N\s*AKHIR|RERATA|GRADE|PREDIKAT|KET|DISKRIPSI|DESKRIPSI|NILAI\s*RAPORT|HER\s*UTS|U\s*R)$/i.test(leafLabel)) {
      continue;
    }
    if (/^Deskripsi/i.test(topLabel) || /^KKTP/i.test(topLabel)) continue;

    const tag = prefixSheet ? `[${sheetName}] ` : "";
    if (tpInfo && tpInfo.code) {
      const desc = tpInfo.desc || `Tujuan Pembelajaran ${tpInfo.code}`;
      if (/^UH$/i.test(leafLabel)) {
        candidates.push({ key: `${sheetName}:f:${tpInfo.code}:uh:${c}`, sheetName, colIndex: c, label: `${tag}${tpInfo.code} · UH`, category: "formative", tpCode: tpInfo.code, tpDescription: desc, field: "uh" });
      } else if (/^T1$/i.test(leafLabel)) {
        candidates.push({ key: `${sheetName}:f:${tpInfo.code}:t1:${c}`, sheetName, colIndex: c, label: `${tag}${tpInfo.code} · Tugas 1`, category: "formative", tpCode: tpInfo.code, tpDescription: desc, field: "t1" });
      } else if (/^T2$/i.test(leafLabel)) {
        candidates.push({ key: `${sheetName}:f:${tpInfo.code}:t2:${c}`, sheetName, colIndex: c, label: `${tag}${tpInfo.code} · Tugas 2`, category: "formative", tpCode: tpInfo.code, tpDescription: desc, field: "t2" });
      } else if (/^T3$/i.test(leafLabel)) {
        candidates.push({ key: `${sheetName}:f:${tpInfo.code}:t3:${c}`, sheetName, colIndex: c, label: `${tag}${tpInfo.code} · Tugas 3`, category: "formative", tpCode: tpInfo.code, tpDescription: desc, field: "t3" });
      } else if (/^(R1|REMIDI|REMEDIAL)$/i.test(leafLabel)) {
        candidates.push({ key: `${sheetName}:f:${tpInfo.code}:remedial:${c}`, sheetName, colIndex: c, label: `${tag}${tpInfo.code} · Remedial`, category: "formative", tpCode: tpInfo.code, tpDescription: desc, field: "remedial" });
      }
      continue;
    }

    if (/\bSTS\b|\bUTS\b/i.test(joined) && !/HER/i.test(joined)) {
      candidates.push({ key: `${sheetName}:t:sts:${c}`, sheetName, colIndex: c, label: `${tag}STS (${leafLabel})`, category: "term", field: "sts" });
    } else if (/\bSAS\b|\bUAS\b|ASS\.?\s*SUM/i.test(joined)) {
      if (!candidates.some((item) => item.category === "term" && item.field === "sas")) {
        candidates.push({ key: `${sheetName}:t:sas:${c}`, sheetName, colIndex: c, label: `${tag}SAS (${leafLabel})`, category: "term", field: "sas" });
      }
    } else if (/^R\s*TP$|SUMATIF|NILAI|SKOR/i.test(leafLabel)) {
      candidates.push({ key: `${sheetName}:s:score:${c}`, sheetName, colIndex: c, label: `${tag}Sumatif (${leafLabel})`, category: "summative", field: "score" });
    }
  }

  const colValues: Record<string, Record<string, string>> = {};
  for (const cand of candidates) colValues[cand.key] = {};
  const unmatched = new Set<string>();
  let skippedEmpty = 0;
  let rejectedInvalid = 0;

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r] ?? [];
    const rawName = String(row[nameCol] ?? "").replace(/\s+/g, " ").trim();
    if (!rawName) continue;
    const matchedStudent = studentByNorm.get(normalizeStudentName(rawName));
    if (!matchedStudent) {
      unmatched.add(rawName);
      continue;
    }
    for (const cand of candidates) {
      const rawCell = String(row[cand.colIndex] ?? "").replace(",", ".").trim();
      if (rawCell === "") {
        skippedEmpty += 1;
        continue;
      }
      const num = Number(rawCell);
      if (Number.isNaN(num) || num < 0 || num > 100) {
        rejectedInvalid += 1;
        continue;
      }
      const rounded = Math.round(num * 100) / 100;
      colValues[cand.key]![matchedStudent.id] = String(rounded).replace(".", ",");
    }
  }

  const columns = candidates
    .map((cand) => {
      const vals = colValues[cand.key] ?? {};
      return { ...cand, matchedCount: Object.keys(vals).length, values: vals };
    })
    .filter((col) => col.matchedCount > 0 || col.category === "term");
  const accepted = columns.reduce((sum, column) => sum + column.matchedCount, 0);
  return {
    columns,
    stats: { accepted, skippedEmpty, rejectedInvalid, unmatchedNames: [...unmatched] },
  };
}

export async function parseGradeFile(
  file: File,
  students: GradeSheetDto["students"],
): Promise<ParsedWorkbookResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xlsm", "xls", "ods"].includes(ext)) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const columnsBySheet: Record<string, DetectedImportColumn[]> = {};
    const allColumns: DetectedImportColumn[] = [];
    const stats = emptyImportStats();
    const multi = wb.SheetNames.length > 1;
    const seenTerm = new Set<string>();

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }).map((r) =>
        (r ?? []).map((c) => String(c ?? "")),
      );
      const parsed = parseMatrixSheet(name, matrix, students, false);
      columnsBySheet[name] = parsed.columns;
      addImportStats(stats, parsed.stats);
      const prefixedCols = parseMatrixSheet(name, matrix, students, multi).columns;
      for (const col of prefixedCols) {
        if (col.category === "term") {
          if (seenTerm.has(col.field) && col.matchedCount === 0) continue;
          if (col.matchedCount > 0) seenTerm.add(col.field);
        }
        allColumns.push(col);
      }
    }
    return { sheetNames: wb.SheetNames, columnsBySheet, allColumns, stats };
  }

  const content = await file.text();
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  const delim = (lines[0] ?? "").includes("\t") ? "\t" : (lines[0] ?? "").includes(";") ? ";" : ",";
  const matrix = lines.map((l) => splitDelimitedLine(l, delim));
  const parsed = parseMatrixSheet("CSV", matrix, students, false);
  return { sheetNames: ["CSV"], columnsBySheet: { CSV: parsed.columns }, allColumns: parsed.columns, stats: parsed.stats };
}

function emptyImportStats(): GradeImportStats {
  return { accepted: 0, skippedEmpty: 0, rejectedInvalid: 0, unmatchedNames: [] };
}

function addImportStats(target: GradeImportStats, next: GradeImportStats): void {
  target.accepted += next.accepted;
  target.skippedEmpty += next.skippedEmpty;
  target.rejectedInvalid += next.rejectedInvalid;
  for (const name of next.unmatchedNames) {
    if (!target.unmatchedNames.includes(name)) target.unmatchedNames.push(name);
  }
}
