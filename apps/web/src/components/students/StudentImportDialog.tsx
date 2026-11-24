import { useMemo, useState } from "react";
import type { ImportClassCount, ImportClassMatch, ImportCommitDto, ImportPreviewDto, ImportPreviewRow, ImportReasonCount, ImportRowStatus, ImportSheetSummary } from "@sims/shared";
import { ApiClientError, api, apiBlob } from "../../lib/api.ts";

const MAX_BYTES = 2 * 1024 * 1024;

type StudentImportDialogProps = {
  schoolId: string;
  years: { id: string; label: string }[];
  operational: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
};

type StatusFilter = "SEMUA" | ImportRowStatus;

const STATUS_LABEL: Record<string, string> = {
  READY_CREATE: "Siap dibuat",
  READY_UPDATE: "Siap diperbarui",
  NEEDS_REVIEW: "Perlu diperiksa",
  DUPLICATE: "Duplikat",
  REJECTED: "Ditolak",
  SKIPPED: "Dilewati",
  VALID: "Valid",
  DUPLIKAT: "Duplikat",
  GAGAL: "Gagal",
};

function csvCell(value: string): string {
  const safe = /^[\d]+$/.test(value) ? `="${value}"` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function rowStatus(row: ImportPreviewRow): string {
  return row.status ?? (row.valid ? "READY_CREATE" : "REJECTED");
}

function downloadClassMap(matches: ImportClassMatch[]) {
  const header = ["sheet", "nama_sumber", "status", "kelas_master", "tingkat", "jumlah_siswa"];
  const lines = matches.map((item) => [
    item.sheet,
    item.sourceName,
    item.status === "MATCHED" ? "Cocok" : item.status === "AMBIGUOUS" ? "Ambigu" : "Belum tersedia",
    item.className ?? "",
    item.gradeLevel === null ? "" : String(item.gradeLevel),
    String(item.studentCount),
  ]);
  const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pemetaan-kelas-siswa.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function downloadReport(rows: ImportPreviewRow[]) {
  const header = ["sheet", "baris", "nama", "nisn", "nis", "kelas", "status", "alasan"];
  const lines = rows
    .filter((row) => rowStatus(row) !== "READY_CREATE" && rowStatus(row) !== "READY_UPDATE")
    .map((row) => [
      row.sheet ?? row.data.sheet ?? "",
      String(row.rowNumber),
      row.data.nama ?? "",
      row.data.nisn ?? "",
      row.data.nis ?? "",
      row.data.kelas ?? "",
      STATUS_LABEL[rowStatus(row)] ?? rowStatus(row),
      row.errors.join("; "),
    ]);
  const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "laporan-pemeriksaan-siswa.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function StudentImportDialog({ schoolId, years, operational, onClose, onImported }: StudentImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [yearId, setYearId] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<ImportCommitDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("SEMUA");
  const [confirming, setConfirming] = useState(false);
  const [confirmClasses, setConfirmClasses] = useState(false);

  const rows = result?.rows ?? preview?.rows ?? [];
  const sheets: ImportSheetSummary[] = preview?.sheets ?? [];
  const classCounts: ImportClassCount[] = preview?.classCounts ?? [];
  const unmapped = preview?.unmappedColumns ?? [];
  const summary = {
    total: result?.totalCount ?? preview?.totalCount ?? rows.length,
    create: result ? result.created : preview?.createCount ?? 0,
    update: result ? result.updated ?? 0 : preview?.updateCount ?? 0,
    review: result?.reviewCount ?? preview?.reviewCount ?? 0,
    duplicate: result?.duplicateCount ?? preview?.duplicateCount ?? 0,
    failed: result?.failedCount ?? preview?.failedCount ?? 0,
    skipped: result?.skippedCount ?? preview?.skippedCount ?? 0,
  };
  const classMatches: ImportClassMatch[] = preview?.classMatches ?? [];
  const reasonCounts: ImportReasonCount[] = preview?.reasonCounts ?? [];
  const missingClasses = classMatches.filter((item) => item.status === "MISSING" && item.gradeLevel !== null && item.gradeLevel >= 10 && item.gradeLevel <= 13);
  const reviewRows = rows.filter((row) => rowStatus(row) === "NEEDS_REVIEW");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "SEMUA" && rowStatus(row) !== statusFilter) return false;
      if (!needle) return true;
      const haystack = [row.sheet, row.data.sheet, row.data.nama, row.data.nisn, row.data.nis, row.data.kelas, row.errors.join(" ")].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, rows, statusFilter]);

  async function downloadTemplate() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ format: "xlsx" });
      if (yearId) params.set("academicYearId", yearId);
      const file = await apiBlob(`/api/v1/schools/${schoolId}/imports/students/template?${params.toString()}`);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename || "templat-siswa.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Template gagal diunduh.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      setError("Berkas harus berformat XLSX atau CSV.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Berkas terlalu besar. Maksimal 2 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    setConfirming(false);
    setFileName(file.name);
    setFile(file);
    const body = new FormData();
    if (yearId) body.append("academicYearId", yearId);
    body.append("file", file);
    try {
      setPreview(await api<ImportPreviewDto>(`/api/v1/schools/${schoolId}/imports/students/preview`, { method: "POST", body }));
      setQuery("");
      setStatusFilter("SEMUA");
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof ApiClientError ? caught.message : "Berkas gagal diperiksa.");
    } finally {
      setBusy(false);
    }
  }

  async function createMissingClasses() {
    if (!file || !yearId || missingClasses.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const item of missingClasses) {
        try {
          await api(`/api/v1/schools/${schoolId}/classes`, {
            method: "POST",
            body: JSON.stringify({
              academicYearId: yearId,
              concentrationId: null,
              name: item.sourceName,
              gradeLevel: item.gradeLevel,
              capacity: 36,
              isActive: true,
            }),
          });
        } catch (caught) {
          if (!(caught instanceof ApiClientError) || caught.status !== 409) throw caught;
        }
      }
      setConfirmClasses(false);
      await upload(file);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Kelas gagal dibuat.");
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<ImportCommitDto>(`/api/v1/schools/${schoolId}/imports/students/commit`, {
        method: "POST",
        body: JSON.stringify({
          ...(yearId ? { academicYearId: yearId } : {}),
          rows: preview.rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data })),
        }),
      });
      setResult(response);
      setPreview({
        ...preview,
        rows: response.rows,
        validCount: response.created + (response.updated ?? 0),
        invalidCount: response.rows.length - response.created - (response.updated ?? 0),
        totalCount: response.totalCount,
        duplicateCount: response.duplicateCount,
        failedCount: response.failedCount,
        reviewCount: response.reviewCount,
        skippedCount: response.skippedCount,
        createCount: response.created,
        updateCount: response.updated ?? 0,
      });
      setConfirming(false);
      onImported(`${response.created} siswa baru disimpan. ${response.updated ?? 0} siswa diperbarui. ${response.skippedCount ?? 0} baris dilewati. ${response.failedCount ?? 0} baris ditolak.`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Impor gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="student-import-title" className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="student-import-title" className="text-lg font-semibold text-slate-900">Import Excel</h2>
            <p className="mt-1 text-sm text-slate-500">Berkas sekolah berlembar banyak diperiksa dulu. Hanya baris siap dibuat atau siap diperbarui yang disimpan setelah konfirmasi. Siswa tidak dihapus, kelas tidak dipindahkan, dan nilai serta rapor tidak diubah.</p>
          </div>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={onClose}>Tutup</button>
        </div>
        {!operational ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">Sekolah ini tidak aktif. Import tidak dapat dilakukan sampai pemilik sistem mengaktifkannya kembali.</p> : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block text-sm font-medium text-slate-700">Tahun pelajaran
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:w-64"
              value={yearId}
              disabled={!operational || busy}
              onChange={(event) => {
                setYearId(event.target.value);
                setPreview(null);
                setResult(null);
                setConfirming(false);
                setError("");
              }}
            >
              <option value="">Tanpa penempatan kelas</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </label>
          <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={!operational || busy} onClick={() => void downloadTemplate()}>Download Template</button>
          <label className={`rounded-xl bg-teal-800 px-4 py-2 text-center text-sm font-semibold text-white ${!operational || busy ? "opacity-50" : ""}`}>
            Pilih File
            <input
              className="hidden"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!operational || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">XLSX atau CSV UTF-8, maksimal 2 MB dan 4.000 baris. NIS, NISN, NIK, dan nomor KK dibaca sebagai teks. Sheet rekap, mutasi, dan statistik tidak dijadikan daftar siswa aktif. Kelas baru tidak dibuat.</p>
        {fileName ? <p className="mt-2 text-sm text-slate-600">Berkas: {fileName}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {result ? <p role="status" className="mt-3 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{summary.create} berhasil disimpan. {summary.update} diperbarui. {summary.skipped} dilewati. {summary.failed} ditolak. {summary.review} tetap menunggu pemeriksaan. {summary.duplicate} duplikat tidak disimpan ulang.</p> : null}
        {preview || result ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="block text-slate-500">Total</span><span className="text-lg font-semibold">{summary.total}</span></p>
              <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm"><span className="block text-teal-800">{result ? "Berhasil" : "Siap dibuat"}</span><span className="text-lg font-semibold">{summary.create}</span></p>
              <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm"><span className="block text-teal-800">{result ? "Diperbarui" : "Siap diperbarui"}</span><span className="text-lg font-semibold">{summary.update}</span></p>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm"><span className="block text-amber-800">Perlu diperiksa</span><span className="text-lg font-semibold">{summary.review}</span></p>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm"><span className="block text-amber-800">Duplikat</span><span className="text-lg font-semibold">{summary.duplicate}</span></p>
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm"><span className="block text-red-800">Ditolak</span><span className="text-lg font-semibold">{summary.failed}</span></p>
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="block text-slate-500">Dilewati</span><span className="text-lg font-semibold">{summary.skipped}</span></p>
            </div>
            {preview?.profilePersistence === "unavailable" ? <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">Nama ayah, nama ibu, NIK, nomor KK, sekolah asal, agama, alamat, dan keterangan tetap ada di hasil pemeriksaan. Nilai itu belum dapat disimpan sebelum pembaruan database disetujui.</p> : null}
            {unmapped.length > 0 ? <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">Kolom belum sesuai tujuan penyimpanan dan tetap ditampilkan untuk verifikasi: {unmapped.join(", ")}.</p> : null}
            {sheets.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Pratinjau sheet</p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {sheets.map((sheet) => (
                    <li key={sheet.name} className="text-sm text-slate-600">{sheet.name}: {sheet.role === "students" ? `${sheet.rowCount} baris siswa` : sheet.role === "historical" ? "historis, bukan siswa aktif" : "non-data"} — {sheet.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {classMatches.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Pemetaan kelas</p>
                <p className="mt-1 text-xs text-slate-500">Nama sheet dipertahankan. Variasi singkatan hanya dipakai untuk mencari kelas yang sudah ada. Kelas yang belum ada tidak dibuat sebelum konfirmasi, dan siswa lama tidak dipindahkan.</p>
                {!yearId ? <p role="status" className="mt-2 text-sm text-amber-900">Pilih tahun pelajaran 2026/2027. Jika tahun itu belum ada, buat dulu di menu Tahun Pelajaran.</p> : null}
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-sm">
                  {classMatches.map((item) => (
                    <li key={item.sheet} className="text-slate-700">
                      {item.sourceName}: {item.studentCount} siswa — {item.status === "MATCHED" ? `cocok dengan ${item.className}` : item.status === "AMBIGUOUS" ? "ambigu, tidak dipetakan" : "belum tersedia"}
                    </li>
                  ))}
                </ul>
                {confirmClasses ? (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                    <p>Buat {missingClasses.length} kelas yang belum tersedia pada tahun pelajaran yang dipilih. Nama kelas mengikuti nama sheet.</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm" disabled={busy} onClick={() => setConfirmClasses(false)}>Batal</button>
                      <button type="button" className="rounded-xl bg-teal-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void createMissingClasses()}>{busy ? "Membuat kelas..." : "Ya, buat kelas"}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={!yearId || busy || missingClasses.length === 0} onClick={() => setConfirmClasses(true)}>Konfirmasi kelas yang belum ada</button>
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm" onClick={() => downloadClassMap(classMatches)}>Unduh pemetaan kelas</button>
                  </div>
                )}
              </div>
            ) : null}
            {reasonCounts.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Alasan pemeriksaan</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {reasonCounts.slice(0, 8).map((item) => (
                    <li key={`${item.status}-${item.reason}`}>{item.count} baris · {STATUS_LABEL[item.status] ?? item.status}: {item.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {classCounts.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Jumlah data per kelas</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {classCounts.map((item) => <li key={item.className} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{item.className}: {item.count}</li>)}
                </ul>
              </div>
            ) : null}
            {reviewRows.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-950">Siswa yang memerlukan pemeriksaan ({reviewRows.length})</p>
                <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-sm text-amber-950">
                  {reviewRows.slice(0, 30).map((row) => (
                    <li key={`${row.sheet ?? ""}-${row.rowNumber}`}>{row.data.nama || "Tanpa nama"} · {row.data.kelas || "kelas belum ada"} · {row.errors.join(" ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:max-w-xs" value={query} placeholder="Cari nama, NISN, NIS, atau kelas" aria-label="Cari hasil pratinjau" onChange={(event) => setQuery(event.target.value)} />
              <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Filter status pratinjau" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="SEMUA">Semua status</option>
                <option value="READY_CREATE">Siap dibuat</option>
                <option value="READY_UPDATE">Siap diperbarui</option>
                <option value="NEEDS_REVIEW">Perlu diperiksa</option>
                <option value="DUPLICATE">Duplikat</option>
                <option value="REJECTED">Ditolak</option>
                <option value="SKIPPED">Dilewati</option>
              </select>
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-50" disabled={rows.every((row) => row.valid)} onClick={() => downloadReport(rows)}>Unduh laporan pemeriksaan</button>
            </div>
            <div className="max-h-80 overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-[860px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Sheet</th>
                    <th className="px-3 py-2 font-medium">Nama</th>
                    <th className="px-3 py-2 font-medium">NISN</th>
                    <th className="px-3 py-2 font-medium">NIS</th>
                    <th className="px-3 py-2 font-medium">Kelas</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? <tr><td className="px-3 py-4 text-slate-500" colSpan={7}>Tidak ada baris pada filter ini.</td></tr> : null}
                  {visible.map((row) => (
                    <tr key={`${row.sheet ?? ""}-${row.rowNumber}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.sheet || row.data.sheet || "-"}</td>
                      <td className="px-3 py-2">{row.data.nama || "-"}</td>
                      <td className="px-3 py-2 font-mono">{row.data.nisn || "-"}</td>
                      <td className="px-3 py-2 font-mono">{row.data.nis?.trim() ? row.data.nis : "Belum diisi"}</td>
                      <td className="px-3 py-2">{row.data.kelas || "-"}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[rowStatus(row)] ?? rowStatus(row)}</td>
                      <td className="px-3 py-2 text-slate-700">{row.errors.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {confirming ? (
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
                <p>Simpan {summary.create} siswa baru dan perbarui {summary.update} siswa. Baris yang perlu diperiksa, duplikat, ditolak, dan dilewati tidak ditulis. Penempatan kelas siswa yang sudah ada tidak diubah.</p>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm" disabled={busy} onClick={() => setConfirming(false)}>Batal</button>
                  <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void commit()}>{busy ? "Menyimpan..." : "Ya, simpan"}</button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!operational || busy || Boolean(result) || (preview?.validCount ?? 0) === 0} onClick={() => setConfirming(true)}>
                  Konfirmasi Simpan
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
