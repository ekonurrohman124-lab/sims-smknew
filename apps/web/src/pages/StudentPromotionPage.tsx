import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppPageShell } from "../components/shell/AppPageShell.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

type ClassItem = { id: string; name: string; gradeLevel: number; academicYearName?: string; concentrationId?: string | null; concentrationName?: string | null };
type StudentRow = { id: string; name: string; nisn: string; nis: string | null; gender: string; classId: string | null; concentrationId?: string | null; isActive?: boolean };
type TransitionResult = {
  succeeded: Array<{ studentId: string; name: string }>;
  failed: Array<{ studentId: string; name: string | null; reason: string }>;
};

async function fetchAll<T>(base: string): Promise<T[]> {
  const items: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  let page = 1;
  while (items.length < total && page <= 100) {
    const joiner = base.includes("?") ? "&" : "?";
    const res = await api<{ items: T[]; total: number }>(`${base}${joiner}page=${page}&pageSize=50`);
    total = res.total;
    items.push(...res.items);
    if (res.items.length === 0) break;
    page += 1;
  }
  return items;
}

export function StudentPromotionPage() {
  const { schoolId } = useSchoolScope();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sourceClassId, setSourceClassId] = useState("");
  const [mode, setMode] = useState<"PROMOTE" | "GRADUATE">("PROMOTE");
  const [targetClassId, setTargetClassId] = useState("");
  const [gradYear, setGradYear] = useState(() => String(new Date().getFullYear()));
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const busy = useRef(false);

  const loadClasses = useCallback(async () => {
    if (!schoolId) return;
    try {
      const items = await fetchAll<ClassItem>(`/api/v1/schools/${schoolId}/classes`);
      setClasses(items);
      setSourceClassId((current) => current || items[0]?.id || "");
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof ApiClientError ? err.message : "Daftar kelas gagal dimuat." });
    }
  }, [schoolId]);

  useEffect(() => { void loadClasses(); }, [loadClasses]);

  const sourceClass = useMemo(() => classes.find((c) => c.id === sourceClassId) ?? null, [classes, sourceClassId]);
  const targetClass = useMemo(() => classes.find((c) => c.id === targetClassId) ?? null, [classes, targetClassId]);

  useEffect(() => {
    if (sourceClass && sourceClass.gradeLevel >= 12) setMode("GRADUATE");
    else setMode("PROMOTE");
  }, [sourceClass]);

  useEffect(() => {
    if (!schoolId || !sourceClassId) { setStudents([]); setSelectedIds(new Set()); return; }
    let active = true;
    setLoadingStudents(true);
    fetchAll<StudentRow>(`/api/v1/schools/${schoolId}/students?classId=${encodeURIComponent(sourceClassId)}`)
      .then((items) => {
        if (!active) return;
        setStudents(items);
        setSelectedIds(new Set(items.map((s) => s.id)));
      })
      .catch((err) => {
        if (!active) return;
        setStudents([]);
        setSelectedIds(new Set());
        setNotice({ kind: "err", text: err instanceof ApiClientError ? err.message : "Daftar siswa gagal dimuat." });
      })
      .finally(() => { if (active) setLoadingStudents(false); });
    return () => { active = false; };
  }, [schoolId, sourceClassId]);

  function toggleStudent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runRollover() {
    if (busy.current || !schoolId || !sourceClass || selectedIds.size === 0) return;
    if (mode === "PROMOTE" && (!targetClassId || targetClassId === sourceClassId)) {
      setNotice({ kind: "err", text: "Pilih rombel tujuan yang berbeda dari kelas asal." });
      return;
    }
    const year = Number(gradYear);
    if (mode === "GRADUATE" && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
      setNotice({ kind: "err", text: "Tahun lulus harus antara 2000 dan 2100." });
      return;
    }
    const studentIds = students.filter((student) => selectedIds.has(student.id)).map((student) => student.id);
    busy.current = true;
    setProcessing(true);
    setNotice(null);
    try {
      const result = await api<TransitionResult>(`/api/v1/schools/${schoolId}/student-transitions`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          sourceClassId,
          ...(mode === "PROMOTE" ? { targetClassId } : { graduationYear: year }),
          studentIds,
        }),
      });
      const reasons = result.failed.slice(0, 5).map((item) => `${item.name ?? "Siswa"}: ${item.reason}`).join("; ");
      const summary = mode === "PROMOTE"
        ? `Naik kelas ${sourceClass.name} ke ${targetClass?.name ?? "rombel tujuan"}: berhasil ${result.succeeded.length}, gagal ${result.failed.length}.`
        : `Kelulusan ${sourceClass.name} angkatan ${year}: berhasil ${result.succeeded.length}, gagal ${result.failed.length}.`;
      setNotice({ kind: result.failed.length === 0 ? "ok" : "err", text: reasons ? `${summary} ${reasons}` : summary });
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof ApiClientError ? err.message : "Transisi siswa gagal diproses." });
    } finally {
      busy.current = false;
      setProcessing(false);
      const refreshed = await fetchAll<StudentRow>(`/api/v1/schools/${schoolId}/students?classId=${encodeURIComponent(sourceClassId)}`).catch(() => []);
      setStudents(refreshed);
      setSelectedIds(new Set(refreshed.map((student) => student.id)));
    }
  }

  return (
    <AppPageShell
      title="Wizard Kenaikan Kelas & Kelulusan"
      subtitle="SOP-01 • Transisi rombel lintas tahun ajaran & kelulusan kelas XII menjadi Alumni."
      rightSlot={
        <Link to="/vokasi/bkk" className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-[#0D1B4C] hover:bg-slate-50">
          Direktori Alumni →
        </Link>
      }
    >
      {notice && (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${notice.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-xs sm:grid-cols-3">
        <div>
          <label className="block text-xs font-bold text-slate-700">1. Kelas / Rombel Asal</label>
          <select
            value={sourceClassId}
            onChange={(e) => setSourceClassId(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900"
          >
            <option value="">-- Pilih Rombel Asal --</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name} (Tingkat {c.gradeLevel})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700">2. Jenis Transisi</label>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("PROMOTE")}
              className={`h-9 rounded-lg text-xs font-extrabold transition ${mode === "PROMOTE" ? "bg-[#0D1B4C] text-white" : "text-slate-600"}`}
            >
              Naik Kelas
            </button>
            <button
              type="button"
              onClick={() => setMode("GRADUATE")}
              className={`h-9 rounded-lg text-xs font-extrabold transition ${mode === "GRADUATE" ? "bg-emerald-700 text-white" : "text-slate-600"}`}
            >
              Lulus (Alumni)
            </button>
          </div>
        </div>

        <div>
          {mode === "PROMOTE" ? (
            <>
              <label className="block text-xs font-bold text-slate-700">3. Rombel Tujuan Baru</label>
              <select
                value={targetClassId}
                onChange={(e) => setTargetClassId(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900"
              >
                <option value="">-- Pilih Rombel Tujuan --</option>
                {classes.filter((c) => c.id !== sourceClassId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} (Tingkat {c.gradeLevel})</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label className="block text-xs font-bold text-slate-700">3. Tahun Angkatan Lulus</label>
              <input
                type="number"
                value={gradYear}
                onChange={(e) => setGradYear(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900"
              />
            </>
          )}
        </div>
      </div>

      <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-[#0D1B4C]">
              Daftar Siswa {sourceClass ? sourceClass.name : ""} ({selectedIds.size}/{students.length} terpilih)
            </h2>
            <p className="text-xs text-slate-500">Hapus centang hanya untuk siswa yang tinggal kelas atau mutasi keluar.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedIds(new Set(students.map((s) => s.id)))} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
              Pilih Semua
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
              Kosongkan
            </button>
          </div>
        </div>

        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">
          {loadingStudents ? (
            <p className="p-6 text-center text-xs text-slate-500">Memuat siswa rombel...</p>
          ) : students.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">Tidak ada siswa aktif pada kelas asal ini.</p>
          ) : (
            students.map((st, idx) => (
              <label key={st.id} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(st.id)}
                    onChange={() => toggleStudent(st.id)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0D1B4C]"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-800">{idx + 1}. {st.name}</p>
                    <p className="text-[11px] text-slate-500">NISN: {st.nisn} {st.nis ? `• NIS: ${st.nis}` : ""}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${selectedIds.has(st.id) ? (mode === "PROMOTE" ? "bg-indigo-100 text-indigo-800" : "bg-emerald-100 text-emerald-800") : "bg-slate-100 text-slate-500"}`}>
                  {selectedIds.has(st.id) ? (mode === "PROMOTE" ? "Naik Kelas" : "Lulus") : "Ditahan"}
                </span>
              </label>
            ))
          )}
        </div>

        {processing && (
          <p className="mt-4 text-xs font-semibold text-slate-600">Memproses transisi data siswa...</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={processing || selectedIds.size === 0 || (mode === "PROMOTE" && !targetClassId)}
            onClick={() => void runRollover()}
            className="min-h-11 rounded-2xl bg-[#0D1B4C] px-6 text-xs font-extrabold text-white shadow-md hover:bg-[#162B75] disabled:opacity-50"
          >
            {processing
              ? "Sedang Memproses..."
              : mode === "PROMOTE"
                ? `Proses Kenaikan ${selectedIds.size} Siswa →`
                : `Luluskan ${selectedIds.size} Siswa ke Alumni →`}
          </button>
        </div>
      </div>
    </AppPageShell>
  );
}
