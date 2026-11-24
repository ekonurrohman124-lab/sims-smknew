import { useCallback, useEffect, useState } from "react";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

type CharacterItem = {
  id: string;
  studentId: string;
  recordType: "PRESTASI" | "PELANGGARAN";
  category: string;
  points: number;
  note: string;
  recordedBy: string | null;
  occurredAt: string;
  student: { id: string; name: string; nisn: string; class: { name: string } | null };
};

type CounselingItem = {
  id: string;
  isAnonymous: boolean;
  reporterLabel: string;
  subject: string;
  description: string;
  status: "BARU" | "DIPROSES" | "SELESAI";
  counselorNote: string | null;
  createdAt: string;
  student: { id: string; name: string; class: { name: string } | null } | null;
};

export function CharacterCounselingPage() {
  const { schoolId } = useSchoolScope();
  const [tab, setTab] = useState<"pembinaan" | "konseling">("pembinaan");
  const [records, setRecords] = useState<CharacterItem[]>([]);
  const [reports, setReports] = useState<CounselingItem[]>([]);
  const [canManageCounseling, setCanManageCounseling] = useState(false);

  // Catatan Pembinaan / Pendampingan (tanpa skor poin)
  const [studentId, setStudentId] = useState("");
  const [recordType, setRecordType] = useState<"PRESTASI" | "PELANGGARAN">("PRESTASI");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  // Layanan Konseling (E-Counseling)
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [charRes, counsRes] = await Promise.all([
        api<{ records: CharacterItem[] }>(`/api/v1/schools/${schoolId}/character-records`).catch((err: unknown) => {
          if (err instanceof ApiClientError && err.status === 403) return { records: [] as CharacterItem[] };
          throw err;
        }),
        api<{ reports: CounselingItem[]; canManageAll: boolean }>(`/api/v1/schools/${schoolId}/counseling-reports`),
      ]);
      setRecords(charRes.records);
      setReports(counsRes.reports);
      setCanManageCounseling(counsRes.canManageAll);
    } catch (err) {
      if (err instanceof ApiClientError && err.status !== 0) {
        setMessage({ kind: "err", text: err.message });
      }
    }
  }, [schoolId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSavePembinaan(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setMessage(null);
    try {
      await api(`/api/v1/schools/${schoolId}/character-records`, {
        method: "POST",
        body: JSON.stringify({
          studentId: studentId.trim(),
          recordType,
          category,
          points: 0,
          note,
        }),
      });
      setCategory("");
      setNote("");
      setMessage({ kind: "ok", text: "Catatan pembinaan siswa berhasil disimpan." });
      await loadAll();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Gagal menyimpan catatan pembinaan." });
    }
  }

  async function handleSaveCounseling(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setMessage(null);
    try {
      await api(`/api/v1/schools/${schoolId}/counseling-reports`, {
        method: "POST",
        body: JSON.stringify({ isAnonymous, subject, description }),
      });
      setSubject("");
      setDescription("");
      setMessage({ kind: "ok", text: "Permohonan bimbingan / konseling berhasil dikirim ke tim BK." });
      await loadAll();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Gagal mengirim pengajuan BK." });
    }
  }

  async function handleCounselingStatus(reportId: string, status: CounselingItem["status"]) {
    if (!schoolId) return;
    setMessage(null);
    try {
      await api(`/api/v1/schools/${schoolId}/counseling-reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          counselorNote:
            status === "DIPROSES"
              ? "Sedang ditangani oleh guru BK / wali kelas."
              : "Sesi pendampingan telah selesai.",
        }),
      });
      setMessage({ kind: "ok", text: `Status layanan BK diperbarui menjadi ${status}.` });
      await loadAll();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Gagal memperbarui status BK." });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-6">
      <section className="rounded-[28px] bg-gradient-to-br from-[#081236] via-[#0D1B4C] to-[#1D3587] p-6 text-white shadow-xl shadow-[#0D1B4C]/15">
        <span className="inline-block rounded-full bg-[#F5C400]/20 px-3 py-1 text-[11px] font-bold tracking-wider text-[#F5C400] uppercase">
          Kesiswaan & Bimbingan Konseling
        </span>
        <h1 className="mt-2 text-xl font-extrabold tracking-tight sm:text-2xl">
          Pembinaan Siswa & Layanan BK
        </h1>
        <p className="mt-1 text-xs text-slate-300">
          Catatan pembinaan positif, pendampingan belajar, dan konsultasi siswa SMK PGRI Pasir Sakti.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-white/10 p-1.5">
          <button
            type="button"
            onClick={() => setTab("pembinaan")}
            className={`rounded-xl py-2.5 text-xs font-extrabold transition ${
              tab === "pembinaan" ? "bg-[#F5C400] text-[#0D1B4C]" : "text-white hover:bg-white/10"
            }`}
          >
            Catatan Pembinaan ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("konseling")}
            className={`rounded-xl py-2.5 text-xs font-extrabold transition ${
              tab === "konseling" ? "bg-[#F5C400] text-[#0D1B4C]" : "text-white hover:bg-white/10"
            }`}
          >
            Layanan BK ({reports.length})
          </button>
        </div>
      </section>

      {message && (
        <div
          className={`rounded-2xl border px-4 py-3.5 text-sm font-medium ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {message.text}
        </div>
      )}

      {tab === "pembinaan" ? (
        <div className="space-y-4">
          <form onSubmit={handleSavePembinaan} className="space-y-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-extrabold text-[#0D1B4C]">Tambah Catatan Pembinaan Siswa</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700">ID Siswa</label>
                <input
                  required
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="ID data siswa"
                  className="mt-1.5 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700">Jenis Catatan</label>
                <select
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value as "PRESTASI" | "PELANGGARAN")}
                  className="mt-1.5 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-[#0D1B4C] focus:bg-white"
                >
                  <option value="PRESTASI">Apresiasi / Prestasi Siswa</option>
                  <option value="PELANGGARAN">Pembinaan & Pendampingan</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">Topik / Kategori Pembinaan</label>
              <input
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Contoh: Keaktifan Praktik Bengkel / Kedisiplinan Masuk"
                className="mt-1.5 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">Uraian Catatan</label>
              <textarea
                required
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Tuliskan catatan pembinaan atau apresiasi untuk siswa dan wali murid..."
                className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
              />
            </div>

            <button
              type="submit"
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110"
            >
              Simpan Catatan Pembinaan
            </button>
          </form>

          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-300 bg-white p-7 text-center text-sm text-slate-500">
                Belum ada catatan pembinaan siswa.
              </div>
            ) : (
              records.map((r) => (
                <div key={r.id} className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-extrabold text-[#0D1B4C]">{r.student.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{r.student.class?.name ?? ""}</span>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                        r.recordType === "PRESTASI"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {r.recordType === "PRESTASI" ? "APRESIASI" : "PEMBINAAN"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-bold text-slate-700">{r.category}</p>
                  <p className="mt-1 text-sm text-slate-600">{r.note}</p>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={handleSaveCounseling} className="space-y-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-extrabold text-[#0D1B4C]">Ajukan Sesi Bimbingan / Konseling</h2>
            <label className="flex cursor-pointer items-center gap-2.5 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0D1B4C]"
              />
              <span>Sembunyikan identitas pelapor (Kirim secara anonim)</span>
            </label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Topik konsultasi (misal: Kendala belajar / Rencana karier & PKL)"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
            />
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ceritakan hal yang ingin dikonsultasikan dengan guru BK..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
            />
            <button
              type="submit"
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110"
            >
              Kirim ke Tim BK
            </button>
          </form>

          <div className="space-y-3">
            {reports.map((rep) => (
              <div key={rep.id} className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold text-[#0D1B4C]">{rep.subject}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
                    {rep.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Pelapor: {rep.isAnonymous ? "Anonim" : rep.reporterLabel}
                </p>
                <p className="mt-2 text-sm text-slate-700">{rep.description}</p>
                {rep.counselorNote && (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <strong>Catatan BK:</strong> {rep.counselorNote}
                  </p>
                )}
                {canManageCounseling && rep.status !== "SELESAI" && (
                  <div className="mt-3 flex gap-2">
                    {rep.status === "BARU" && (
                      <button
                        type="button"
                        onClick={() => void handleCounselingStatus(rep.id, "DIPROSES")}
                        className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-extrabold text-white"
                      >
                        Proses
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCounselingStatus(rep.id, "SELESAI")}
                      className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white"
                    >
                      Selesai
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
