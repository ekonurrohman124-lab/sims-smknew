import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { FormativeGradeCell, GradeSheetDto, SummativeGradeCell, TermExamCell } from "@sims/shared";
import { GradeMarkIcon, GradeMarkLegend, gradeMarkLabel, type CellMark } from "../components/grade/GradeMarks.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { usePortal } from "../lib/portal.tsx";
import { GradeImportModal } from "../components/GradeImportModal.tsx";
import { AppPageShell } from "../components/shell/AppPageShell.tsx";
import { parseGradeFile, type DetectedImportColumn, type ParsedWorkbookResult } from "../lib/gradeImport.ts";
import { useSchoolScope } from "../lib/school.tsx";

const EMPTY_ASSIGNMENT = "Anda belum memiliki penugasan mengajar. Silakan hubungi Wakasek Kurikulum.";
type TabId = "formatif" | "sumatif" | "ujian";
type FormativeField = "uh" | "t1" | "t2" | "t3" | "remedial";
type SummativeField = "score" | "remedial";
type TermField = "sts" | "sas";
type CellLock = "DRAFT" | "SUBMITTED" | "REVISION_REQUESTED" | "LEGACY";

function lockFor(sheet: GradeSheetDto, key: string): CellLock {
  if (sheet.legacyLock) return "LEGACY";
  return sheet.components.find((item) => item.key === key)?.status ?? "DRAFT";
}

const FORMATIVE_FIELDS: { key: FormativeField; label: string }[] = [
  { key: "uh", label: "UH" },
  { key: "t1", label: "Tugas 1" },
  { key: "t2", label: "Tugas 2" },
  { key: "t3", label: "Tugas 3" },
];

const FORMATIVE_COMPONENT_OPTIONS: { value: FormativeField; label: string }[] = [
  { value: "uh", label: "UH" },
  { value: "t1", label: "Tugas 1" },
  { value: "t2", label: "Tugas 2" },
  { value: "t3", label: "Tugas 3" },
  { value: "remedial", label: "Remedial" },
];

function componentMark(status: CellLock): CellMark {
  if (status === "SUBMITTED" || status === "LEGACY") return "submitted";
  if (status === "REVISION_REQUESTED") return "revision";
  return "saved";
}

function componentStatusLabel(status: CellLock): string {
  if (status === "SUBMITTED") return "Terkirim";
  if (status === "REVISION_REQUESTED") return "Menunggu revisi";
  if (status === "LEGACY") return "Terkunci status lama";
  return "Draf";
}

function ComponentPicker({
  value,
  onChange,
  options,
  status,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  status: CellLock;
}) {
  return (
    <label className="w-full text-[13px] font-semibold text-slate-700 sm:w-56">Komponen
      <span className="mt-0.5 flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pr-1">
        <GradeMarkIcon mark={componentMark(status)} className="ml-2 h-3.5 w-3.5 shrink-0" />
        <select aria-label="Komponen yang dikirim" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent pr-1 text-sm font-semibold">
          {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <span className="sr-only">{componentStatusLabel(status)}</span>
      </span>
    </label>
  );
}

function gradeComponentLocked(sheet: GradeSheetDto, key: string): boolean {
  if (sheet.legacyLock) return true;
  const component = sheet.components.find((item) => item.key === key);
  return Boolean(component && (component.locked || component.status !== "DRAFT"));
}

function formatScore(value: number | null): string {
  if (value === null) return "";
  return String(value).replace(".", ",");
}

function parseScore(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  if (value > 100) return { ok: false };
  return { ok: true, value };
}

function same(raw: string, saved: number | null): boolean {
  const parsed = parseScore(raw);
  return parsed.ok && parsed.value === saved;
}

type LeaveIntent =
  | { kind: "href"; href: string }
  | { kind: "logout" }
  | { kind: "assignment"; id: string };

export function GradePage() {
  const { schoolId } = useSchoolScope();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { teachings, loading: portalLoading } = usePortal();
  const [params] = useSearchParams();
  const requested = params.get("penugasan");
  const [assignmentId, setAssignmentId] = useState("");
  const [sheet, setSheet] = useState<GradeSheetDto | null>(null);
  const [tab, setTab] = useState<TabId>("formatif");
  const [formativeField, setFormativeField] = useState<FormativeField>("uh");
  const [termField, setTermField] = useState<TermField>("sts");
  const [objectiveId, setObjectiveId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [formativeDraft, setFormativeDraft] = useState<Record<string, string>>({});
  const [summativeDraft, setSummativeDraft] = useState<Record<string, string>>({});
  const [termDraft, setTermDraft] = useState<Record<string, string>>({});
  const [showRemedial, setShowRemedial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [dialog, setDialog] = useState<"submit" | "revision" | "import" | null>(null);
  const [importData, setImportData] = useState<ParsedWorkbookResult | null>(null);
  const [importSheetName, setImportSheetName] = useState("__ALL__");
  const [detectedCols, setDetectedCols] = useState<DetectedImportColumn[]>([]);
  const [selectedColKeys, setSelectedColKeys] = useState<string[]>([]);
  const [importingMulti, setImportingMulti] = useState(false);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<LeaveIntent | null>(null);

  useEffect(() => {
    if (teachings.length === 0) {
      setAssignmentId("");
      return;
    }
    const match = teachings.some((item) => item.id === requested) ? requested : teachings[0]?.id;
    setAssignmentId(match ?? "");
  }, [teachings, requested]);

  useEffect(() => {
    if (!schoolId || !assignmentId) return;
    let active = true;
    setLoading(true);
    setError("");
    api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${assignmentId}/scores`)
      .then((data) => {
        if (!active) return;
        applySheet(data.sheet);
      })
      .catch((caught) => {
        if (!active) return;
        setSheet(null);
        setError(caught instanceof ApiClientError ? caught.message : "Nilai gagal dimuat.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [schoolId, assignmentId]);

  function applySheet(next: GradeSheetDto) {
    setSheet(next);
    setObjectiveId((current) => next.formative.some((item) => item.learningObjectiveId === current) ? current : next.formative[0]?.learningObjectiveId ?? "");
    setScopeId((current) => next.summative.some((item) => item.materialScopeId === current) ? current : next.summative[0]?.materialScopeId ?? "");
    const formative: Record<string, string> = {};
    for (const column of next.formative) {
      for (const cell of column.cells) {
        for (const field of ["uh", "t1", "t2", "t3", "remedial"] as const) {
          formative[`${column.learningObjectiveId}:${cell.studentId}:${field}`] = formatScore(cell[field]);
        }
      }
    }
    const summative: Record<string, string> = {};
    for (const column of next.summative) {
      for (const cell of column.cells) {
        summative[`${column.materialScopeId}:${cell.studentId}:score`] = formatScore(cell.score);
        summative[`${column.materialScopeId}:${cell.studentId}:remedial`] = formatScore(cell.remedial);
      }
    }
    const term: Record<string, string> = {};
    for (const cell of next.termExams) {
      term[`${cell.studentId}:sts`] = formatScore(cell.sts);
      term[`${cell.studentId}:sas`] = formatScore(cell.sas);
    }
    setFormativeDraft(formative);
    setSummativeDraft(summative);
    setTermDraft(term);
    setMessage("");
  }

  const objective = sheet?.formative.find((item) => item.learningObjectiveId === objectiveId) ?? null;
  const scope = sheet?.summative.find((item) => item.materialScopeId === scopeId) ?? null;
  const remedialNeeded = useMemo(() => {
    if (!sheet) return false;
    if (tab === "formatif" && objective) return objective.cells.some((cell) => cell.remedial !== null);
    if (tab === "sumatif" && scope) return scope.cells.some((cell) => cell.remedial !== null);
    return false;
  }, [sheet, tab, objective, scope]);

  useEffect(() => {
    if (remedialNeeded) setShowRemedial(true);
  }, [remedialNeeded, objectiveId, scopeId, tab]);

  const dirtyCount = useMemo(() => countDirty(sheet, formativeDraft, summativeDraft, termDraft), [sheet, formativeDraft, summativeDraft, termDraft]);
  const activeComponent = useMemo(() => {
    if (!sheet || sheet.legacyLock) return null;
    if (tab === "formatif") return sheet.components.find((item) => item.key === `f:${formativeField}:${objectiveId}`) ?? null;
    if (tab === "sumatif") return sheet.components.find((item) => item.key === `s:${scopeId}`) ?? null;
    return sheet.components.find((item) => item.key === termField) ?? null;
  }, [sheet, tab, formativeField, objectiveId, scopeId, termField]);
  const invalid = useMemo(() => hasInvalid(sheet, formativeDraft, summativeDraft, termDraft), [sheet, formativeDraft, summativeDraft, termDraft]);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (anchor instanceof HTMLAnchorElement) {
        if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        const next = `${url.pathname}${url.search}${url.hash}`;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (next === current) return;
        event.preventDefault();
        event.stopPropagation();
        setLeaveIntent({ kind: "href", href: next });
        return;
      }
      const button = target.closest("button");
      if (button && /^Keluar/.test(button.textContent?.trim() ?? "")) {
        event.preventDefault();
        event.stopPropagation();
        setLeaveIntent({ kind: "logout" });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirtyCount]);

  function requestAssignment(nextId: string) {
    if (nextId === assignmentId) return;
    if (dirtyCount > 0) {
      setLeaveIntent({ kind: "assignment", id: nextId });
      return;
    }
    setAssignmentId(nextId);
  }

  function confirmLeave() {
    const intent = leaveIntent;
    setLeaveIntent(null);
    if (!intent) return;
    if (intent.kind === "href") navigate(intent.href);
    if (intent.kind === "logout") void logout();
    if (intent.kind === "assignment") setAssignmentId(intent.id);
  }

  function openImportDialog() {
    setImportData(null);
    setImportSheetName("__ALL__");
    setDetectedCols([]);
    setSelectedColKeys([]);
    setDialog("import");
  }

  function handleSelectImportSheet(nextSheet: string, data: ParsedWorkbookResult | null = importData) {
    setImportSheetName(nextSheet);
    if (!data) return;
    const cols = nextSheet === "__ALL__" ? data.allColumns : (data.columnsBySheet[nextSheet] ?? []);
    setDetectedCols(cols);
    setSelectedColKeys(cols.filter((c) => c.matchedCount > 0).map((c) => c.key));
  }

  async function handleImportFile(file: File) {
    if (!sheet) return;
    const parsed = await parseGradeFile(file, sheet.students);
    setImportData(parsed);
    const defaultTarget = parsed.sheetNames.length > 1 ? "__ALL__" : (parsed.sheetNames[0] ?? "__ALL__");
    handleSelectImportSheet(defaultTarget, parsed);
  }

  async function applyMultiColumnImport() {
    if (!sheet || !schoolId) return;
    const chosen = detectedCols.filter((c) => selectedColKeys.includes(c.key) && c.matchedCount > 0);
    if (chosen.length === 0) return;
    setImportingMulti(true);
    setError("");
    setMessage("");
    try {
      let currentSheet = sheet;
      const activeTeaching = teachings.find((t) => t.id === currentSheet.assignmentId);

      // Buat TP otomatis jika belum ada di server
      const neededTps = new Map<string, string>();
      for (const col of chosen) {
        if (col.category === "formative" && col.tpCode) {
          const exists = currentSheet.formative.some((f) => f.code.trim().toUpperCase() === col.tpCode!.toUpperCase());
          if (!exists && !neededTps.has(col.tpCode.toUpperCase())) {
            neededTps.set(col.tpCode.toUpperCase(), col.tpDescription || `Tujuan Pembelajaran ${col.tpCode}`);
          }
        }
      }
      if (neededTps.size > 0 && activeTeaching) {
        let seq = currentSheet.formative.length + 1;
        for (const [code, description] of neededTps.entries()) {
          await api(`/api/v1/schools/${schoolId}/learning-objectives`, {
            method: "POST",
            body: JSON.stringify({
              classId: activeTeaching.classId,
              subjectId: activeTeaching.subjectId,
              academicPeriodId: activeTeaching.academicPeriodId,
              code,
              description,
              sequence: seq,
            }),
          });
          seq += 1;
        }
        const refreshed = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${currentSheet.assignmentId}/scores`);
        currentSheet = refreshed.sheet;
      }

      // Buat Lingkup Materi otomatis jika ada kolom Sumatif
      if (chosen.some((c) => c.category === "summative") && currentSheet.summative.length === 0 && activeTeaching) {
        await api(`/api/v1/schools/${schoolId}/material-scopes`, {
          method: "POST",
          body: JSON.stringify({
            classId: activeTeaching.classId,
            subjectId: activeTeaching.subjectId,
            academicPeriodId: activeTeaching.academicPeriodId,
            code: "LM 1",
            description: "Lingkup Materi 1 (Impor Otomatis)",
            sequence: 1,
          }),
        });
        const refreshed = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${currentSheet.assignmentId}/scores`);
        currentSheet = refreshed.sheet;
      }

      // Gabungkan seluruh draft & nilai impor
      const nextFormative: Record<string, string> = { ...formativeDraft };
      for (const col of currentSheet.formative) {
        for (const cell of col.cells) {
          for (const field of ["uh", "t1", "t2", "t3", "remedial"] as const) {
            const k = `${col.learningObjectiveId}:${cell.studentId}:${field}`;
            if (nextFormative[k] === undefined) nextFormative[k] = formatScore(cell[field]);
          }
        }
      }
      const nextSummative: Record<string, string> = { ...summativeDraft };
      for (const col of currentSheet.summative) {
        for (const cell of col.cells) {
          const k = `${col.materialScopeId}:${cell.studentId}:score`;
          if (nextSummative[k] === undefined) nextSummative[k] = formatScore(cell.score);
        }
      }
      const nextTerm: Record<string, string> = { ...termDraft };
      for (const cell of currentSheet.termExams) {
        for (const field of ["sts", "sas"] as const) {
          const k = `${cell.studentId}:${field}`;
          if (nextTerm[k] === undefined) nextTerm[k] = formatScore(cell[field]);
        }
      }

      let appliedCells = 0;
      let skippedLocked = 0;
      let rejectedCells = 0;
      for (const col of chosen) {
        const entries = Object.entries(col.values);
        if (col.category === "formative" && col.tpCode) {
          const targetObj = currentSheet.formative.find((f) => f.code.trim().toUpperCase() === col.tpCode!.toUpperCase());
          if (!targetObj) {
            rejectedCells += entries.length;
            continue;
          }
          if (gradeComponentLocked(currentSheet, `f:${col.field}:${targetObj.learningObjectiveId}`)) {
            skippedLocked += entries.length;
            continue;
          }
          for (const [studentId, val] of entries) {
            nextFormative[`${targetObj.learningObjectiveId}:${studentId}:${col.field}`] = val;
            appliedCells += 1;
          }
        } else if (col.category === "summative" && currentSheet.summative[0]) {
          const targetScope = currentSheet.summative[0];
          if (gradeComponentLocked(currentSheet, `s:${targetScope.materialScopeId}`)) {
            skippedLocked += entries.length;
            continue;
          }
          for (const [studentId, val] of entries) {
            nextSummative[`${targetScope.materialScopeId}:${studentId}:score`] = val;
            appliedCells += 1;
          }
        } else if (col.category === "term") {
          if (gradeComponentLocked(currentSheet, col.field)) {
            skippedLocked += entries.length;
            continue;
          }
          for (const [studentId, val] of entries) {
            nextTerm[`${studentId}:${col.field}`] = val;
            appliedCells += 1;
          }
        } else {
          rejectedCells += entries.length;
        }
      }

      // Auto-Save langsung ke server
      const formative = collectFormative(currentSheet, nextFormative);
      const summative = collectSummative(currentSheet, nextSummative);
      const termExams = collectTerm(currentSheet, nextTerm);
      if (formative.length + summative.length + termExams.length > 0) {
        const saved = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${currentSheet.assignmentId}/scores`, {
          method: "PATCH",
          body: JSON.stringify({ formative, summative, termExams }),
        });
        applySheet(saved.sheet);
      } else {
        applySheet(currentSheet);
      }

      const firstCat = chosen[0]?.category;
      if (firstCat === "term") {
        setTab("ujian");
        if (chosen[0]?.field === "sts" || chosen[0]?.field === "sas") setTermField(chosen[0].field);
      } else if (firstCat === "summative") {
        setTab("sumatif");
      } else if (firstCat === "formative") {
        setTab("formatif");
        const firstTp = currentSheet.formative.find((f) => f.code.trim().toUpperCase() === chosen[0]?.tpCode?.toUpperCase());
        if (firstTp) setObjectiveId(firstTp.learningObjectiveId);
      }

      const skipped = (importData?.stats.skippedEmpty ?? 0) + skippedLocked;
      const failed = (importData?.stats.rejectedInvalid ?? 0) + (importData?.stats.unmatchedNames.length ?? 0) + rejectedCells;
      const summary = `Impor nilai: berhasil ${appliedCells}, dilewati ${skipped}, gagal ${failed}.`;
      setSaveFailed(false);
      if (failed > 0) setError(summary);
      else setMessage(summary);
      setDialog(null);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Gagal menyimpan impor otomatis.");
    } finally {
      setImportingMulti(false);
    }
  }

  function toggleAllImportCols() {
    const f = detectedCols.filter((c) => c.matchedCount > 0).map((c) => c.key);
    setSelectedColKeys((prev) => (prev.length === f.length ? [] : f));
  }
  async function save() {
    if (sheet?.legacyLock) return;
    if (!schoolId || !sheet || invalid) {
      setError("Nilai harus 0–100, maksimal 2 desimal. Kosongkan jika belum ada nilai.");
      return;
    }
    const formative = collectFormative(sheet, formativeDraft);
    const summative = collectSummative(sheet, summativeDraft);
    const termExams = collectTerm(sheet, termDraft);
    if (formative.length + summative.length + termExams.length === 0) {
      setMessage("Tidak ada perubahan nilai.");
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    setError("");
    setMessage("");
    try {
      const data = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${sheet.assignmentId}/scores`, {
        method: "PATCH",
        body: JSON.stringify({ formative, summative, termExams }),
      });
      applySheet(data.sheet);
      setMessage("Nilai tersimpan.");
    } catch (caught) {
      setSaveFailed(true);
      setError(caught instanceof ApiClientError ? caught.message : "Nilai gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function submitGrades() {
    if (!schoolId || !sheet || !activeComponent) return;
    setActing(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${sheet.assignmentId}/scores/submit`, {
        method: "POST",
        body: JSON.stringify({ componentKey: activeComponent.key }),
      });
      applySheet(data.sheet);
      setDialog(null);
      setMessage(`${activeComponent.label} terkirim ke wali kelas dan terkunci.`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Nilai gagal dikirim.");
    } finally {
      setActing(false);
    }
  }

  async function requestRevision() {
    if (!schoolId || !sheet || !activeComponent || reason.trim().length < 10) return;
    setActing(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ sheet: GradeSheetDto }>(`/api/v1/schools/${schoolId}/teaching-assignments/${sheet.assignmentId}/scores/revision-request`, {
        method: "POST",
        body: JSON.stringify({ componentKey: activeComponent?.key, reason: reason.trim() }),
      });
      applySheet(data.sheet);
      setDialog(null);
      setReason("");
      setMessage("Permintaan revisi terkirim ke wali kelas. Komponen ini tetap terkunci sampai disetujui.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Permintaan revisi gagal dikirim.");
    } finally {
      setActing(false);
    }
  }

  if (portalLoading) return <p className="text-base text-slate-500">Memuat penugasan...</p>;
  if (!portalLoading && teachings.length === 0) {
    return <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-base leading-7 text-slate-600">{EMPTY_ASSIGNMENT}</p>;
  }

  return (
    <AppPageShell
      badge="Akademik & Penilaian"
      title="Input Nilai"
      flushBody
      subtitle={sheet?.legacyLock ? "Status lama tidak dipetakan. Seluruh nilai tetap terkunci." : activeComponent?.status === "SUBMITTED" ? `${activeComponent.label} sudah dikirim dan terkunci.` : activeComponent?.status === "REVISION_REQUESTED" ? `${activeComponent.label} menunggu keputusan wali kelas.` : "Setiap komponen dikirim sendiri kepada wali kelas."}
      rightSlot={<label className="block text-xs font-semibold text-slate-700">Kelas dan mapel<select value={assignmentId} onChange={(e) => requestAssignment(e.target.value)} className="mt-1 block h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 lg:min-w-80">{teachings.map((i) => <option key={i.id} value={i.id}>{i.className} · {i.subjectName} · {i.periodName}</option>)}</select></label>}
      bannerSlot={error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      tabsSlot={sheet ? <div className="flex flex-wrap items-center gap-2">{(["formatif", "sumatif", "ujian"] as const).map((i) => <button key={i} type="button" onClick={() => setTab(i)} className={`h-9 rounded-xl px-3.5 text-sm font-semibold transition ${tab === i ? "bg-[#0D1B4C] text-[#F5C400] shadow-xs" : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>{i === "formatif" ? "Formatif" : i === "sumatif" ? "Sumatif" : "STS/SAS"}</button>)}<p className="ml-auto hidden text-xs font-medium text-slate-600 lg:block">{sheet.className} · {sheet.subjectName} · Guru {sheet.teacherName}</p></div> : null}
    >
      {loading || !sheet ? <p className="px-6 py-6 text-base text-slate-500">Memuat nilai...</p> : (
        <section className="flex flex-col md:min-h-0 md:flex-1">
          <p className="shrink-0 px-4 py-1.5 text-[13px] text-slate-600 lg:hidden">{sheet.className} · {sheet.subjectName} · Guru {sheet.teacherName}</p>
          {sheet.legacyLock ? <p className="shrink-0 px-3 py-1 text-[11px] leading-snug text-orange-800">{sheet.legacyLock.reason ? `Alasan status lama: ${sheet.legacyLock.reason}. ` : ""}{`Status ${sheet.legacyLock.status === "REVISION_REQUESTED" ? "permintaan revisi" : "terkirim"} lama berlaku untuk seluruh penugasan dan tidak dipecah ke komponen.`}</p> : null}
          {sheet.submissionHold ? <p className="shrink-0 px-3 py-1 text-[11px] leading-snug text-amber-800">{sheet.submissionHold}</p> : null}
          {activeComponent?.status === "REVISION_REQUESTED" && activeComponent.revisionReason ? <p className="shrink-0 px-3 py-1 text-[11px] leading-none text-orange-800">Alasan revisi {activeComponent.label}: {activeComponent.revisionReason}</p> : null}
          {tab === "formatif" ? (
            <FormatifPanel
              sheet={sheet}
              objectiveId={objectiveId}
              onObjective={setObjectiveId}
              componentField={formativeField}
              onComponentField={setFormativeField}
              draft={formativeDraft}
              onDraft={setFormativeDraft}
              showRemedial={showRemedial}
              saving={saving}
              saveFailed={saveFailed}
              onToggleRemedial={() => setShowRemedial((current) => !current)}
              statusFor={(field) => lockFor(sheet, `f:${field}:${objectiveId}`)}
            />
          ) : null}
          {tab === "sumatif" ? (
            <SumatifPanel
              sheet={sheet}
              scopeId={scopeId}
              onScope={setScopeId}
              draft={summativeDraft}
              onDraft={setSummativeDraft}
              showRemedial={showRemedial}
              saving={saving}
              saveFailed={saveFailed}
              onToggleRemedial={() => setShowRemedial((current) => !current)}
              statusFor={() => lockFor(sheet, `s:${scopeId}`)}
            />
          ) : null}
          {tab === "ujian" ? <UjianPanel sheet={sheet} componentField={termField} onComponentField={setTermField} draft={termDraft} onDraft={setTermDraft} saving={saving} saveFailed={saveFailed} statusFor={(field) => lockFor(sheet, field)} /> : null}
          <div className="z-20 flex shrink-0 flex-col gap-1.5 border-t border-slate-200 bg-white px-4 py-1.5 max-md:sticky max-md:bottom-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p aria-live="polite" className={`text-[13px] sm:truncate ${saving ? "font-semibold text-sky-800" : dirtyCount > 0 ? "font-semibold text-amber-800" : message ? "font-semibold text-teal-800" : "text-slate-600"}`}>
                {saving ? "Menyimpan perubahan..." : dirtyCount > 0 ? `${dirtyCount} perubahan belum disimpan` : message ? message : sheet.legacyLock ? "Seluruh nilai tetap terkunci oleh status lama." : "Semua perubahan sudah tersimpan"}
                <span className="mt-0.5 block font-normal text-slate-500 sm:ml-2 sm:mt-0 sm:inline">Kosong berarti belum diisi. Angka 0 tetap nol.</span>
              </p>
              <div className="mt-1 h-4 overflow-x-auto overflow-y-hidden"><GradeMarkLegend /></div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center">
              <span className="inline-flex h-9 items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                <GradeMarkIcon mark={sheet.legacyLock ? "submitted" : componentMark(activeComponent?.status ?? "DRAFT")} />
                {sheet.legacyLock ? "Terkunci status lama" : activeComponent ? `${activeComponent.label} · ${componentStatusLabel(activeComponent.status)}` : "Pilih komponen"}
              </span>
              {activeComponent?.status === "DRAFT" ? (
                <button type="button" onClick={() => setDialog("submit")} disabled={saving || acting || dirtyCount > 0 || Boolean(sheet.submissionHold) || activeComponent.filled === 0 || activeComponent.missingRequired > 0} title={sheet.submissionHold ?? (dirtyCount > 0 ? "Simpan perubahan terlebih dahulu" : activeComponent.filled === 0 ? "Belum ada nilai tersimpan" : `Kirim ${activeComponent.label}`)} className="h-9 rounded-lg border border-violet-300 bg-white px-3 text-sm font-semibold text-violet-800 disabled:opacity-60">
                  Kirim Komponen
                </button>
              ) : null}
              {activeComponent?.status === "SUBMITTED" ? (
                <button type="button" onClick={() => setDialog("revision")} disabled={acting} className="h-9 rounded-lg border border-orange-300 bg-white px-3 text-sm font-semibold text-orange-800">
                  Ajukan Revisi
                </button>
              ) : null}
              {!sheet.legacyLock ? <button type="button" onClick={openImportDialog} disabled={saving || acting} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">Import Nilai</button> : null}
              <button type="button" onClick={() => void save()} disabled={Boolean(sheet.legacyLock) || saving || dirtyCount === 0} title={sheet.legacyLock ? "Nilai terkunci oleh status lama" : undefined} className="h-9 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </section>
      )}
      {dialog && sheet ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4 pb-24 pt-6 sm:pb-8">
          <div role="dialog" aria-modal="true" aria-labelledby="grade-action-title" className="max-h-[78vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            {dialog === "import" ? <GradeImportModal importData={importData} importSheetName={importSheetName} detectedCols={detectedCols} selectedColKeys={selectedColKeys} importing={importingMulti} onFile={(f) => void handleImportFile(f)} onSelectSheet={handleSelectImportSheet} onToggleKey={(k, c) => setSelectedColKeys((prev) => (c ? [...prev, k] : prev.filter((x) => x !== k)))} onToggleAll={toggleAllImportCols} onClose={() => setDialog(null)} onApply={() => void applyMultiColumnImport()} /> : dialog === "submit" && activeComponent ? (
              <>
                <h2 id="grade-action-title" className="text-lg font-semibold text-slate-900">Kirim {activeComponent.label}?</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{sheet.className} · {sheet.subjectName} · {sheet.periodName}. Hanya komponen ini yang terkunci.</p>
                <p className="mt-3 text-sm text-slate-800">{activeComponent.filled} siswa terisi, {Math.max(activeComponent.total - activeComponent.filled, 0)} siswa kosong.</p>
                <p className="mt-1 text-sm text-slate-700">{sheet.recipientName ? `Dikirim kepada wali kelas ${sheet.recipientName}.` : sheet.submissionHold}</p>
                {sheet.completeness.warning ? <p className="mt-3 text-sm leading-6 text-amber-800">{sheet.completeness.warning}</p> : null}
                {activeComponent.missingRequired > 0 ? <p className="mt-3 text-sm text-red-700">Komponen wajib belum lengkap.</p> : null}
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Batal</button>
                  <button type="button" onClick={() => void submitGrades()} disabled={acting || activeComponent.missingRequired > 0 || activeComponent.filled === 0 || Boolean(sheet.submissionHold)} className="h-9 rounded-lg bg-violet-800 px-3 text-sm font-semibold text-white disabled:opacity-60">{acting ? "Mengirim..." : "Kirim komponen"}</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="grade-action-title" className="text-lg font-semibold text-slate-900">Ajukan revisi {activeComponent?.label ?? "komponen"}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Hanya komponen ini yang diajukan. Komponen lain tidak berubah. Nilai tetap terkunci sampai wali kelas menyetujui.</p>
                <label className="mt-3 block text-sm font-semibold text-slate-700">Alasan
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-normal" />
                </label>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setDialog(null)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Batal</button>
                  <button type="button" onClick={() => void requestRevision()} disabled={acting || reason.trim().length < 10} className="h-9 rounded-lg bg-orange-700 px-3 text-sm font-semibold text-white disabled:opacity-60">{acting ? "Mengirim..." : "Kirim permintaan"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {leaveIntent ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="leave-title" className="text-xl font-semibold text-slate-900">Perubahan belum disimpan</h2>
            <p className="mt-2 text-base leading-7 text-slate-600">
              Ada {dirtyCount} perubahan nilai yang belum disimpan. {leaveIntent.kind === "assignment" ? "Mengganti kelas akan membuang perubahan itu." : "Tinggalkan halaman ini?"}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setLeaveIntent(null)} className="rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold text-slate-800">Tetap di halaman</button>
              <button type="button" onClick={confirmLeave} className="rounded-xl bg-amber-700 px-4 py-3 text-base font-semibold text-white">Tinggalkan</button>
            </div>
          </div>
        </div>
      ) : null}
    </AppPageShell>
  );
}

function FormatifPanel({
  sheet,
  objectiveId,
  onObjective,
  componentField,
  onComponentField,
  draft,
  onDraft,
  showRemedial,
  saving,
  saveFailed,
  onToggleRemedial,
  statusFor,
}: {
  sheet: GradeSheetDto;
  objectiveId: string;
  onObjective: (id: string) => void;
  componentField: FormativeField;
  onComponentField: (field: FormativeField) => void;
  draft: Record<string, string>;
  onDraft: (next: Record<string, string>) => void;
  showRemedial: boolean;
  saving: boolean;
  saveFailed: boolean;
  onToggleRemedial: () => void;
  statusFor: (field: string) => CellLock;
}) {
  const column = sheet.formative.find((item) => item.learningObjectiveId === objectiveId) ?? null;
  if (sheet.formative.length === 0) {
    return <p className="mx-4 rounded-xl bg-white px-4 py-4 text-base text-slate-600 sm:mx-6">Belum ada tujuan pembelajaran. Tambahkan TP pada menu TP & Lingkup Materi.</p>;
  }
  if (sheet.students.length === 0) return <EmptyStudents />;
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="flex shrink-0 flex-col gap-1.5 px-3 py-1.5 sm:flex-row sm:items-end">
        <label className="flex-1 text-[13px] font-semibold text-slate-700">Tujuan pembelajaran
          <select value={objectiveId} onChange={(event) => onObjective(event.target.value)} className="mt-0.5 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm">
            {sheet.formative.map((item) => <option key={item.learningObjectiveId} value={item.learningObjectiveId}>{item.code} · {item.description}</option>)}
          </select>
        </label>
        <ComponentPicker value={componentField} onChange={(value) => onComponentField(value as FormativeField)} options={FORMATIVE_COMPONENT_OPTIONS} status={statusFor(componentField)} />
        <button type="button" onClick={onToggleRemedial} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">{showRemedial ? "Sembunyikan remedial" : "Isi remedial"}</button>
      </div>
      {column ? <StudentGrid rows={sheet.students.map((student) => ({ student, cell: column.cells.find((item) => item.studentId === student.id) }))} fields={FORMATIVE_FIELDS} extra={showRemedial ? [{ key: "remedial", label: "Remedial" }] : []} draft={draft} prefix={column.learningObjectiveId} saving={saving} saveFailed={saveFailed} statusFor={statusFor} onChange={(key, value) => onDraft({ ...draft, [key]: value })} savedOf={(cell, field) => (cell as FormativeGradeCell)[field as FormativeField]} /> : null}
    </div>
  );
}

function SumatifPanel({
  sheet,
  scopeId,
  onScope,
  draft,
  onDraft,
  showRemedial,
  saving,
  saveFailed,
  onToggleRemedial,
  statusFor,
}: {
  sheet: GradeSheetDto;
  scopeId: string;
  onScope: (id: string) => void;
  draft: Record<string, string>;
  onDraft: (next: Record<string, string>) => void;
  showRemedial: boolean;
  saving: boolean;
  saveFailed: boolean;
  onToggleRemedial: () => void;
  statusFor: (field: string) => CellLock;
}) {
  const column = sheet.summative.find((item) => item.materialScopeId === scopeId) ?? null;
  if (sheet.summative.length === 0) {
    return <p className="mx-4 rounded-xl bg-white px-4 py-4 text-base text-slate-600 sm:mx-6">Belum ada lingkup materi. Tambahkan LM pada menu TP & Lingkup Materi.</p>;
  }
  if (sheet.students.length === 0) return <EmptyStudents />;
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="flex shrink-0 flex-col gap-1.5 px-3 py-1.5 sm:flex-row sm:items-end">
        <label className="flex-1 text-[13px] font-semibold text-slate-700">Lingkup materi
          <select aria-label="Komponen yang dikirim" value={scopeId} onChange={(event) => onScope(event.target.value)} className="mt-0.5 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm">
            {sheet.summative.map((item) => <option key={item.materialScopeId} value={item.materialScopeId}>{item.code} · {item.description}</option>)}
          </select>
        </label>
        <span className="inline-flex h-9 items-center gap-1.5 self-end rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-700">
          <GradeMarkIcon mark={componentMark(statusFor("score"))} />
          {componentStatusLabel(statusFor("score"))}
        </span>
        <button type="button" onClick={onToggleRemedial} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">{showRemedial ? "Sembunyikan remedial" : "Isi remedial"}</button>
      </div>
      {column ? <StudentGrid rows={sheet.students.map((student) => ({ student, cell: column.cells.find((item) => item.studentId === student.id) }))} fields={[{ key: "score", label: "Nilai" }]} extra={showRemedial ? [{ key: "remedial", label: "Remedial" }] : []} draft={draft} prefix={column.materialScopeId} saving={saving} saveFailed={saveFailed} statusFor={statusFor} onChange={(key, value) => onDraft({ ...draft, [key]: value })} savedOf={(cell, field) => (cell as SummativeGradeCell)[field as SummativeField]} /> : null}
    </div>
  );
}

function UjianPanel({ sheet, componentField, onComponentField, draft, onDraft, saving, saveFailed, statusFor }: { sheet: GradeSheetDto; componentField: TermField; onComponentField: (field: TermField) => void; draft: Record<string, string>; onDraft: (next: Record<string, string>) => void; saving: boolean; saveFailed: boolean; statusFor: (field: string) => CellLock }) {
  if (!sheet.stsEnabled && !sheet.sasEnabled) {
    return <p className="mx-4 rounded-xl bg-white px-4 py-4 text-base text-slate-600 sm:mx-6">STS dan SAS tidak diaktifkan oleh sekolah.</p>;
  }
  if (sheet.students.length === 0) return <EmptyStudents />;
  const fields = [
    ...(sheet.stsEnabled ? [{ key: "sts", label: "STS" }] : []),
    ...(sheet.sasEnabled ? [{ key: "sas", label: "SAS" }] : []),
  ];
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="flex shrink-0 items-end gap-1.5 px-3 py-1.5">
        <ComponentPicker
          value={componentField}
          onChange={(value) => onComponentField(value as TermField)}
          options={[...(sheet.stsEnabled ? [{ value: "sts", label: "STS" }] : []), ...(sheet.sasEnabled ? [{ value: "sas", label: "SAS" }] : [])]}
          status={statusFor(componentField)}
        />
        <p className="pb-2 text-[13px] text-slate-600">STS dan SAS tidak wajib.</p>
      </div>
      <StudentGrid rows={sheet.students.map((student) => ({ student, cell: sheet.termExams.find((item) => item.studentId === student.id) }))} fields={fields} extra={[]} draft={draft} prefix="" saving={saving} saveFailed={saveFailed} statusFor={statusFor} onChange={(key, value) => onDraft({ ...draft, [key]: value })} savedOf={(cell, field) => (cell as TermExamCell)[field as TermField]} />
    </div>
  );
}

function EmptyStudents() {
  return <p className="mx-4 rounded-xl bg-white px-4 py-4 text-base text-slate-600 sm:mx-6">Belum ada siswa aktif di kelas ini.</p>;
}

function StudentGrid({
  rows,
  fields,
  extra,
  draft,
  prefix,
  saving,
  saveFailed,
  statusFor,
  onChange,
  savedOf,
}: {
  rows: { student: { id: string; name: string; nis: string | null }; cell: FormativeGradeCell | SummativeGradeCell | TermExamCell | undefined }[];
  fields: { key: string; label: string }[];
  extra: { key: string; label: string }[];
  draft: Record<string, string>;
  prefix: string;
  saving: boolean;
  saveFailed: boolean;
  statusFor: (field: string) => CellLock;
  onChange: (key: string, value: string) => void;
  savedOf: (cell: FormativeGradeCell | SummativeGradeCell | TermExamCell, field: string) => number | null;
}) {
  const columns = [...fields, ...extra];
  function keyFor(studentId: string, field: string) {
    return prefix ? `${prefix}:${studentId}:${field}` : `${studentId}:${field}`;
  }
  function cellInput(student: { id: string; name: string }, cell: FormativeGradeCell | SummativeGradeCell | TermExamCell | undefined, column: { key: string; label: string }) {
    return (
      <ScoreInput
        label={`${column.label} ${student.name}`}
        value={draft[keyFor(student.id, column.key)] ?? ""}
        saved={cell ? savedOf(cell, column.key) : null}
        saving={saving}
        saveFailed={saveFailed}
        lock={statusFor(column.key)}
        onChange={(value) => onChange(keyFor(student.id, column.key), value)}
      />
    );
  }
  return (
    <>
      <div data-grade-grid data-grade-columns={columns.length} className="mx-3 mb-2 hidden min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none] rounded-lg border border-slate-300 bg-white md:block">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="h-10">
              <th className="sticky top-0 left-0 z-30 h-10 w-12 border-b border-r border-slate-300 bg-slate-100 px-2 text-center text-[13px] font-semibold text-slate-700">No</th>
              <th className="sticky top-0 left-12 z-30 h-10 min-w-52 border-b border-r border-slate-300 bg-slate-100 px-3 text-[13px] font-semibold text-slate-700 shadow-[4px_0_8px_-4px_rgba(15,23,42,0.35)]">Nama siswa</th>
              {columns.map((column) => (
                <th key={column.key} className="sticky top-0 z-20 h-10 min-w-28 border-b border-slate-300 bg-slate-100 px-2 text-center text-[13px] font-semibold text-slate-700">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, cell }, index) => {
              const stripe = index % 2 === 0 ? "bg-white" : "bg-slate-50";
              return (
                <tr key={student.id} className={`h-[52px] ${stripe}`}>
                  <td className={`sticky left-0 z-10 w-12 border-b border-r border-slate-200 px-2 text-center text-sm font-semibold text-slate-500 ${stripe}`}>{index + 1}</td>
                  <td className={`sticky left-12 z-10 min-w-52 border-b border-r border-slate-200 px-3 shadow-[4px_0_8px_-4px_rgba(15,23,42,0.25)] ${stripe}`}>
                    <p className="truncate text-sm font-semibold leading-tight text-slate-900">{student.name}</p>
                    {student.nis ? <p className="text-xs leading-tight text-slate-500">{student.nis}</p> : null}
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="border-b border-slate-200 px-2 py-0.5 align-middle focus-within:bg-teal-50">
                      {cellInput(student, cell, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div data-grade-grid data-grade-columns={columns.length} className="mx-3 mb-2 space-y-2 md:hidden">
        {rows.map(({ student, cell }, index) => (
          <article key={student.id} className="rounded-xl border border-slate-300 bg-white p-3">
            <p className="text-xs font-semibold text-slate-500">No. {index + 1}</p>
            <h2 className="text-base font-semibold leading-tight text-slate-900">{student.name}</h2>
            {student.nis ? <p className="text-xs text-slate-500">{student.nis}</p> : null}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {columns.map((column) => (
                <label key={column.key} className="text-[13px] font-semibold text-slate-700">{column.label}
                  {cellInput(student, cell, column)}
                </label>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function moveGradeFocus(current: HTMLInputElement, backward: boolean) {
  const grid = current.closest("[data-grade-grid]");
  if (!(grid instanceof HTMLElement)) return;
  const inputs = [...grid.querySelectorAll<HTMLInputElement>("input[data-grade-input]")];
  const index = inputs.indexOf(current);
  if (index < 0) return;
  const columns = Number(grid.dataset.gradeColumns || "1");
  const step = backward ? -columns : columns;
  const next = inputs[index + step] ?? inputs[index + (backward ? -1 : 1)];
  if (!next) return;
  next.focus();
  next.select();
}

function ScoreInput({
  label,
  value,
  saved,
  saving,
  saveFailed,
  lock,
  onChange,
}: {
  label: string;
  value: string;
  saved: number | null;
  saving: boolean;
  saveFailed: boolean;
  lock: CellLock;
  onChange: (value: string) => void;
}) {
  const status = scoreStatus(value, saved, saving, saveFailed, lock);
  const [editing, setEditing] = useState(false);
  const locked = lock !== "DRAFT";
  return (
    <span className="relative block">
      <input
        aria-label={`${label}, ${status.label}`}
        title={status.label}
        data-grade-input=""
        inputMode="decimal"
        disabled={locked}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          setEditing(true);
          event.currentTarget.select();
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          moveGradeFocus(event.currentTarget, event.shiftKey);
        }}
        className={`h-[34px] w-full min-w-20 rounded-md border px-1.5 pr-5 text-center text-sm font-semibold tabular-nums outline-none disabled:cursor-not-allowed ${editing && !locked ? "border-teal-700 bg-teal-50 shadow-[0_0_0_3px_rgba(15,118,110,0.22)]" : status.input}`}
      />
      <span className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2" title={status.label}>
        <GradeMarkIcon mark={status.mark} />
        <span className="sr-only">{gradeMarkLabel(status.mark)}</span>
      </span>
    </span>
  );
}

function scoreStatus(
  value: string,
  saved: number | null,
  saving: boolean,
  saveFailed: boolean,
  lock: CellLock,
): { mark: CellMark; label: string; input: string } {
  const parsed = parseScore(value);
  if (!parsed.ok) return { mark: "failed", label: "Tidak valid", input: "border-red-400 bg-red-50" };
  if (lock === "LEGACY") return { mark: "submitted", label: "Terkunci oleh status lama", input: "border-violet-300 bg-violet-50/40" };
  if (lock === "SUBMITTED") return { mark: "submitted", label: gradeMarkLabel("submitted"), input: "border-violet-300 bg-violet-50/40" };
  if (lock === "REVISION_REQUESTED") return { mark: "revision", label: gradeMarkLabel("revision"), input: "border-orange-300 bg-orange-50/50" };
  const dirty = !same(value, saved);
  if (saving && dirty) return { mark: "saving", label: gradeMarkLabel("saving"), input: "border-sky-400 bg-sky-50" };
  if (saveFailed && dirty) return { mark: "failed", label: gradeMarkLabel("failed"), input: "border-red-400 bg-red-50" };
  if (dirty) return { mark: "dirty", label: gradeMarkLabel("dirty"), input: "border-amber-400 bg-amber-50" };
  if (parsed.value === null) return { mark: "empty", label: gradeMarkLabel("empty"), input: "border-slate-300 bg-white" };
  return { mark: "saved", label: gradeMarkLabel("saved"), input: "border-teal-300 bg-white" };
}

function countDirty(sheet: GradeSheetDto | null, formative: Record<string, string>, summative: Record<string, string>, term: Record<string, string>): number {
  if (!sheet) return 0;
  let count = 0;
  for (const column of sheet.formative) {
    for (const cell of column.cells) {
      for (const field of ["uh", "t1", "t2", "t3", "remedial"] as const) {
        const raw = formative[`${column.learningObjectiveId}:${cell.studentId}:${field}`] ?? "";
        if (parseScore(raw).ok && !same(raw, cell[field])) count += 1;
      }
    }
  }
  for (const column of sheet.summative) {
    for (const cell of column.cells) {
      for (const field of ["score", "remedial"] as const) {
        const raw = summative[`${column.materialScopeId}:${cell.studentId}:${field}`] ?? "";
        if (parseScore(raw).ok && !same(raw, cell[field])) count += 1;
      }
    }
  }
  for (const cell of sheet.termExams) {
    for (const field of ["sts", "sas"] as const) {
      if (field === "sts" && !sheet.stsEnabled) continue;
      if (field === "sas" && !sheet.sasEnabled) continue;
      const raw = term[`${cell.studentId}:${field}`] ?? "";
      if (parseScore(raw).ok && !same(raw, cell[field])) count += 1;
    }
  }
  return count;
}

function hasInvalid(sheet: GradeSheetDto | null, formative: Record<string, string>, summative: Record<string, string>, term: Record<string, string>): boolean {
  if (!sheet) return false;
  const values = [...Object.values(formative), ...Object.values(summative), ...Object.values(term)];
  return values.some((value) => !parseScore(value).ok);
}

function collectFormative(sheet: GradeSheetDto, draft: Record<string, string>) {
  const rows: { learningObjectiveId: string; studentId: string; uh?: number | null; t1?: number | null; t2?: number | null; t3?: number | null; remedial?: number | null }[] = [];
  for (const column of sheet.formative) {
    for (const cell of column.cells) {
      const change: { learningObjectiveId: string; studentId: string; uh?: number | null; t1?: number | null; t2?: number | null; t3?: number | null; remedial?: number | null } = {
        learningObjectiveId: column.learningObjectiveId,
        studentId: cell.studentId,
      };
      let used = false;
      for (const field of ["uh", "t1", "t2", "t3", "remedial"] as const) {
        const raw = draft[`${column.learningObjectiveId}:${cell.studentId}:${field}`] ?? "";
        const parsed = parseScore(raw);
        if (parsed.ok && !same(raw, cell[field])) {
          change[field] = parsed.value;
          used = true;
        }
      }
      if (used) rows.push(change);
    }
  }
  return rows;
}

function collectSummative(sheet: GradeSheetDto, draft: Record<string, string>) {
  const rows: { materialScopeId: string; studentId: string; score?: number | null; remedial?: number | null }[] = [];
  for (const column of sheet.summative) {
    for (const cell of column.cells) {
      const change: { materialScopeId: string; studentId: string; score?: number | null; remedial?: number | null } = {
        materialScopeId: column.materialScopeId,
        studentId: cell.studentId,
      };
      let used = false;
      for (const field of ["score", "remedial"] as const) {
        const raw = draft[`${column.materialScopeId}:${cell.studentId}:${field}`] ?? "";
        const parsed = parseScore(raw);
        if (parsed.ok && !same(raw, cell[field])) {
          change[field] = parsed.value;
          used = true;
        }
      }
      if (used) rows.push(change);
    }
  }
  return rows;
}

function collectTerm(sheet: GradeSheetDto, draft: Record<string, string>) {
  const rows: { studentId: string; sts?: number | null; sas?: number | null }[] = [];
  for (const cell of sheet.termExams) {
    const change: { studentId: string; sts?: number | null; sas?: number | null } = { studentId: cell.studentId };
    let used = false;
    if (sheet.stsEnabled) {
      const raw = draft[`${cell.studentId}:sts`] ?? "";
      const parsed = parseScore(raw);
      if (parsed.ok && !same(raw, cell.sts)) {
        change.sts = parsed.value;
        used = true;
      }
    }
    if (sheet.sasEnabled) {
      const raw = draft[`${cell.studentId}:sas`] ?? "";
      const parsed = parseScore(raw);
      if (parsed.ok && !same(raw, cell.sas)) {
        change.sas = parsed.value;
        used = true;
      }
    }
    if (used) rows.push(change);
  }
  return rows;
}
