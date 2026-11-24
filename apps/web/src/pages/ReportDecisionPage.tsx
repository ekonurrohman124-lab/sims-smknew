import { useEffect, useRef, useState } from "react";
import { ReportPreviewSheet, type PreviewStudent } from "../components/report/ReportPreviewSheet.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

type Row = {
  studentId: string;
  academicPeriodId: string;
  name: string;
  nis: string | null;
  nisn: string | null;
  className: string;
  periodName: string;
  status: string;
  stale: boolean;
  printStatus: string;
};
type Dossier = {
  context: { className: string; curriculumLabel: string | null };
  student: PreviewStudent;
  reviewStatus: string;
  reviews: Array<{ id: string; reviewedAt: string }>;
  workflow: { status: string; wakakurReason: string | null; principalReason: string | null; version: number } | null;
  events: Array<{ id: string; action: string; toStatus: string; reason: string | null; createdAt: string }>;
};

const inputClass = "h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm";

export function ReportDecisionPage({ mode }: { mode: "validation" | "endorsement" }) {
  const { schoolId } = useSchoolScope();
  const [view, setView] = useState<"queue" | "endorsed">("queue");
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("SEMUA");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Row | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const batchLock = useRef(false);
  const title = mode === "validation" ? "Validasi Rapor" : "Pengesahan Rapor";
  const path = mode === "validation" ? "report-validations" : "report-endorsements";

  function load() {
    if (!schoolId) return;
    const suffix = mode === "endorsement" && view === "endorsed" ? "?view=endorsed" : "";
    api<{ rows: Row[] }>(`/api/v1/schools/${schoolId}/${path}${suffix}`)
      .then((result) => { setRows(result.rows); setMessage(""); })
      .catch((error: unknown) => setMessage(error instanceof ApiClientError ? error.message : "Daftar rapor gagal dimuat."));
  }

  useEffect(() => { setSelected(null); setPage(1); load(); }, [schoolId, mode, view]);

  useEffect(() => {
    if (!schoolId || !selected) { setDossier(null); return; }
    const params = new URLSearchParams({ studentId: selected.studentId, academicPeriodId: selected.academicPeriodId });
    api<Dossier>(`/api/v1/schools/${schoolId}/report-dossiers?${params}`)
      .then(setDossier)
      .catch((error: unknown) => setMessage(error instanceof ApiClientError ? error.message : "Detail rapor gagal dimuat."));
  }, [schoolId, selected]);

  const filtered = rows.filter((row) => {
    const haystack = `${row.name} ${row.nis ?? ""} ${row.nisn ?? ""} ${row.className}`.toLowerCase();
    if (query && !haystack.includes(query.trim().toLowerCase())) return false;
    if (status === "BERUBAH") return row.stale;
    if (status === "SIAP") return !row.stale && row.printStatus === "SIAP_CETAK";
    return true;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function decideBatch() {
    if (!schoolId || view !== "queue" || batchLock.current) return;
    const readyRows = filtered.filter((row) => !row.stale && row.printStatus === "SIAP_CETAK" && row.status !== "DISAHKAN");
    const blocked = filtered.length - readyRows.length;
    if (readyRows.length === 0) {
      setMessage(blocked > 0 ? `Pengesahan massal: berhasil 0, ditolak ${blocked}, gagal 0. Rapor yang belum lengkap atau berubah tidak diproses.` : "Tidak ada rapor pada daftar ini.");
      return;
    }
    batchLock.current = true;
    setBusy(true);
    let succeeded = 0;
    let rejected = blocked;
    let failed = 0;
    const notes: string[] = [];
    const decision = mode === "validation" ? "approve" : "endorse";
    for (const item of readyRows) {
      try {
        await api(`/api/v1/schools/${schoolId}/${path}/decision`, {
          method: "POST",
          body: JSON.stringify({ studentId: item.studentId, academicPeriodId: item.academicPeriodId, decision }),
        });
        succeeded += 1;
      } catch (error: unknown) {
        const text = error instanceof ApiClientError ? error.message : "Tidak dapat terhubung ke server.";
        if (notes.length < 3) notes.push(`${item.name}: ${text}`);
        if (error instanceof ApiClientError && (error.status === 409 || error.status === 400 || error.status === 404)) rejected += 1;
        else failed += 1;
      }
    }
    const summary = `Pengesahan massal: berhasil ${succeeded}, ditolak ${rejected}, gagal ${failed}.`;
    setMessage(notes.length > 0 ? `${summary} ${notes.join("; ")}` : summary);
    setSelected(null);
    batchLock.current = false;
    setBusy(false);
    load();
  }

  async function decide(decision: "approve" | "return" | "endorse") {
    if (!schoolId || !selected) return;
    setBusy(true);
    try {
      const target = decision === "endorse" && view === "endorsed" ? "report-endorsements/revision" : `${path}/decision`;
      await api(`/api/v1/schools/${schoolId}/${target}`, {
        method: "POST",
        body: JSON.stringify(decision === "endorse" && view === "endorsed"
          ? { studentId: selected.studentId, academicPeriodId: selected.academicPeriodId, reason }
          : { studentId: selected.studentId, academicPeriodId: selected.academicPeriodId, decision, reason: reason || undefined }),
      });
      setMessage("Keputusan rapor tersimpan.");
      setReason("");
      setSelected(null);
      load();
    } catch (error: unknown) {
      setMessage(error instanceof ApiClientError ? error.message : "Keputusan gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-4 pb-28">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{mode === "validation" ? "Wakakur menyetujui atau mengembalikan rapor yang diajukan wali kelas." : "Kepala sekolah mengesahkan rapor yang sudah disetujui Wakakur."}</p>
      </div>
      {message ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {mode === "endorsement" ? (
          <select className={inputClass} value={view} onChange={(event) => setView(event.target.value === "endorsed" ? "endorsed" : "queue")}>
            <option value="queue">Menunggu pengesahan</option>
            <option value="endorsed">Sudah disahkan</option>
          </select>
        ) : null}
        <input className={inputClass} placeholder="Cari siswa atau kelas" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        <select className={inputClass} aria-label="Filter status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="SEMUA">Semua</option>
          <option value="SIAP">Data masih sesuai</option>
          <option value="BERUBAH">Data berubah</option>
        </select>
        {view === "queue" ? (
          <button type="button" className="h-8 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void decideBatch()}>
            {mode === "validation" ? "Setujui yang siap" : "Sahkan yang siap"}
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Siswa</th><th className="px-3 py-2">Kelas</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th></tr>
          </thead>
          <tbody>
            {visible.length === 0 ? <tr><td className="px-3 py-3 text-slate-500" colSpan={4}>Tidak ada rapor pada daftar ini.</td></tr> : null}
            {visible.map((row) => (
              <tr key={`${row.studentId}-${row.academicPeriodId}`} className="border-t border-slate-100">
                <td className="px-3 py-2"><p className="font-medium">{row.name}</p><p className="text-xs text-slate-500">{row.nis ?? "—"} · {row.nisn ?? "—"}</p></td>
                <td className="px-3 py-2">{row.className}<p className="text-xs text-slate-500">{row.periodName}</p></td>
                <td className="px-3 py-2">{row.stale ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">Data berubah</span> : <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">{row.status === "DISAHKAN" ? "Disahkan" : row.status === "DIAJUKAN" ? "Diajukan" : "Disetujui Wakakur"}</span>}</td>
                <td className="px-3 py-2"><button type="button" className="text-sky-700" onClick={() => setSelected(row)}>Buka</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="h-8 rounded-lg border border-slate-300 px-2 disabled:opacity-50" disabled={safePage <= 1} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button>
        <span>{safePage}/{pages}</span>
        <button type="button" className="h-8 rounded-lg border border-slate-300 px-2 disabled:opacity-50" disabled={safePage >= pages} onClick={() => setPage((value) => value + 1)}>Berikutnya</button>
        <select className={inputClass} aria-label="Ukuran halaman" value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>
          <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
        </select>
      </div>
      {selected && dossier ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-sm text-slate-600">Pemeriksaan wali kelas: {dossier.reviewStatus === "SUDAH_DIPERIKSA" ? "sudah diperiksa" : "belum diperiksa"} · {dossier.reviews.length} riwayat</p>
          {dossier.events.length > 0 ? <ul className="space-y-1 text-xs text-slate-600">{dossier.events.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleString("id-ID")} · {event.action}{event.reason ? ` · ${event.reason}` : ""}</li>)}</ul> : null}
          {view === "queue" ? (
            <div className="space-y-2">
              <textarea className="min-h-16 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Alasan wajib diisi jika dikembalikan" value={reason} onChange={(event) => setReason(event.target.value)} />
              <div className="flex flex-wrap gap-2">
                {mode === "validation" ? <button type="button" className="h-8 rounded-lg bg-violet-700 px-3 text-sm text-white disabled:opacity-50" disabled={busy || selected.stale} onClick={() => decide("approve")}>Setujui</button> : null}
                {mode === "endorsement" ? <button type="button" className="h-8 rounded-lg bg-emerald-700 px-3 text-sm text-white disabled:opacity-50" disabled={busy || selected.stale} onClick={() => decide("endorse")}>Sahkan Rapor</button> : null}
                <button type="button" className="h-8 rounded-lg bg-orange-700 px-3 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => decide("return")}>Kembalikan untuk Perbaikan</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea className="min-h-16 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Alasan revisi" value={reason} onChange={(event) => setReason(event.target.value)} />
              <button type="button" className="h-8 rounded-lg bg-orange-700 px-3 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => decide("endorse")}>Buka Revisi</button>
            </div>
          )}
          <ReportPreviewSheet student={dossier.student} className={dossier.context.className} curriculumLabel={dossier.context.curriculumLabel} structureStatus="TERSEDIA" />
        </div>
      ) : null}
    </section>
  );
}
