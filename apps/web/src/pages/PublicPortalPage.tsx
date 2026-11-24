import { useCallback, useEffect, useRef, useState } from "react";
import type { AnonymousReportDto, PpdbApplicantDto, PpdbStatus, WhistleblowerCategory, WhistleblowerStatus } from "@sims/shared";
import { ApiClientError, api } from "../lib/api.ts";
import { enqueueOfflineRequest, flushOfflineQueue, getOfflineQueue } from "../lib/offline-sync.ts";
import { useSchoolScope } from "../lib/school.tsx";

export function PublicPortalPage({ mode }: { mode: "ppdb" | "whistleblower" }) {
  const { schoolId } = useSchoolScope();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [queueCount, setQueueCount] = useState<number>(() => getOfflineQueue().length);

  // PPDB state
  const [applicants, setApplicants] = useState<PpdbApplicantDto[]>([]);
  const [fullName, setFullName] = useState("");
  const [nisn, setNisn] = useState("");
  const [originSchool, setOriginSchool] = useState("");
  const [chosenMajor, setChosenMajor] = useState("Teknik Kendaraan Ringan (TKR)");
  const [parentPhone, setParentPhone] = useState("");
  const [averageScore, setAverageScore] = useState("");

  // Whistleblower state
  const [reports, setReports] = useState<AnonymousReportDto[]>([]);
  const [category, setCategory] = useState<WhistleblowerCategory>("PERUNDUNGAN_BULLYING");
  const [incidentPlace, setIncidentPlace] = useState("");
  const [description, setDescription] = useState("");
  const [lastTicket, setLastTicket] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const syncStatus = async () => {
      setIsOnline(navigator.onLine);
      setQueueCount(getOfflineQueue().length);
      if (navigator.onLine) {
        const res = await flushOfflineQueue();
        if (res.synced > 0) {
          setSuccess(`Sinkronisasi luring selesai: ${res.synced} transaksi terkirim ke server.`);
        }
      }
    };
    window.addEventListener("online", syncStatus);
    window.addEventListener("offline", syncStatus);
    window.addEventListener("sakti-offline-queue-changed", () => setQueueCount(getOfflineQueue().length));
    return () => {
      window.removeEventListener("online", syncStatus);
      window.removeEventListener("offline", syncStatus);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "ppdb") {
        const data = await api<PpdbApplicantDto[]>(`/api/v1/schools/${schoolId}/ppdb/applicants`);
        setApplicants(data);
      } else {
        const data = await api<AnonymousReportDto[]>(`/api/v1/schools/${schoolId}/whistleblower/reports`);
        setReports(data);
      }
    } catch (err) {
      if (mode === "whistleblower" && err instanceof ApiClientError && err.status === 403) {
        setReports([]);
        return;
      }
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat data portal.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, mode]);

  useEffect(() => {
    setError(null);
    setSuccess(null);
    void loadData();
  }, [loadData]);

  async function handleRegisterPpdb(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId || submitLock.current) return;
    const score = averageScore.trim() === "" ? undefined : Number(averageScore);
    if (fullName.trim().length < 2 || originSchool.trim().length < 2 || chosenMajor.trim().length < 2 || parentPhone.trim().length < 6) {
      setError("Lengkapi nama, asal sekolah, jurusan, dan telepon orang tua sebelum mengirim.");
      return;
    }
    if (nisn.trim().length > 20 || (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100))) {
      setError("NISN atau nilai rata-rata tidak valid.");
      return;
    }
    submitLock.current = true;
    setBusy("ppdb-submit");
    setError(null);
    setSuccess(null);

    const payload = {
      fullName: fullName.trim(),
      nisn: nisn.trim() || undefined,
      originSchool: originSchool.trim(),
      chosenMajor: chosenMajor.trim(),
      parentPhone: parentPhone.trim(),
      averageScore: score,
    };

    if (!navigator.onLine) {
      enqueueOfflineRequest({
        endpoint: `/api/v1/schools/${schoolId}/ppdb/applicants`,
        method: "POST",
        body: JSON.stringify(payload),
        label: `PPDB: ${payload.fullName}`,
      });
      setError("Belum tersimpan di server. Pendaftaran masuk antrean dan baru berhasil setelah tersinkron.");
      submitLock.current = false;
      setBusy(null);
      return;
    }

    try {
      const created = await api<PpdbApplicantDto>(`/api/v1/schools/${schoolId}/ppdb/applicants`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setFullName("");
      setNisn("");
      setOriginSchool("");
      setParentPhone("");
      setAverageScore("");
      setSuccess(`Pendaftaran berhasil dengan Nomor Registrasi: ${created.registrationNo}`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal mendaftarkan calon siswa.");
    } finally {
      submitLock.current = false;
      setBusy(null);
    }
  }

  async function handleUpdatePpdb(applicantId: string, status: PpdbStatus) {
    if (!schoolId) return;
    setBusy(applicantId);
    setError(null);
    try {
      await api<PpdbApplicantDto>(`/api/v1/schools/${schoolId}/ppdb/applicants/${applicantId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setSuccess(`Status calon siswa diperbarui menjadi ${status}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memperbarui status PPDB.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId || submitLock.current) return;
    if (description.trim().length < 10 || description.trim().length > 2000) {
      setError("Uraian laporan harus 10 sampai 2000 karakter.");
      return;
    }
    if (incidentPlace.trim().length > 160) {
      setError("Lokasi kejadian terlalu panjang.");
      return;
    }
    submitLock.current = true;
    setBusy("report-submit");
    setError(null);
    setSuccess(null);

    const payload = {
      category,
      incidentPlace: incidentPlace.trim() || undefined,
      description: description.trim(),
    };

    if (!navigator.onLine) {
      enqueueOfflineRequest({
        endpoint: `/api/v1/schools/${schoolId}/whistleblower/reports`,
        method: "POST",
        body: JSON.stringify(payload),
        label: "Laporan Anti-Bullying",
      });
      setError("Belum tersimpan di server. Laporan masuk antrean dan baru berhasil setelah tersinkron.");
      submitLock.current = false;
      setBusy(null);
      return;
    }

    try {
      const created = await api<AnonymousReportDto>(`/api/v1/schools/${schoolId}/whistleblower/reports`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setIncidentPlace("");
      setDescription("");
      setLastTicket(created.ticketCode);
      setSuccess(`Laporan aman terkirim secara anonim. Simpan kode tiket Anda: ${created.ticketCode}`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal mengirim laporan anonim.");
    } finally {
      submitLock.current = false;
      setBusy(null);
    }
  }

  async function handleUpdateReport(reportId: string, status: WhistleblowerStatus) {
    if (!schoolId) return;
    setBusy(reportId);
    setError(null);
    try {
      await api<AnonymousReportDto>(`/api/v1/schools/${schoolId}/whistleblower/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          counselorReply:
            status === "DITINDAKLANJUTI"
              ? "Laporan diterima tim BK & sedang ditangani secara rahasia."
              : "Penanganan selesai dan situasi telah kondusif.",
        }),
      });
      setSuccess(`Tiket pengaduan diperbarui ke status ${status}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memperbarui status laporan.");
    } finally {
      setBusy(null);
    }
  }

  if (!schoolId) {
    return (
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-6 shadow-sm text-sm text-slate-600 shadow-sm">
        Pilih sekolah aktif terlebih dahulu.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-br from-[#081236] via-[#0D1B4C] to-[#1D3587] p-6 shadow-xl shadow-[#0D1B4C]/15 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-full bg-[#F5C400]/20 px-3 py-1 text-xs font-semibold text-[#F5C400]">
              {mode === "ppdb" ? "PENERIMAAN PESERTA DIDIK BARU" : "SATUAN TUGAS PENCEGAHAN PERUNDUNGAN"}
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {mode === "ppdb"
                ? "PPDB Online & Seleksi Jurusan SMK"
                : "Kanal Anti-Bullying & Whistleblower Anonim"}
            </h1>
            <p className="mt-1 text-sm text-slate-200">
              {mode === "ppdb"
                ? "Pendaftaran calon peserta didik baru, verifikasi berkas, dan penetapan kelulusan kompetensi keahlian."
                : "Pelaporan insiden perundungan atau keamanan sekolah tanpa mencatat identitas pelapor."}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span>{isOnline ? "Daring (Online)" : "Luring (Offline Sync Siap)"}</span>
            {queueCount > 0 && (
              <span className="ml-1 rounded-full bg-[#F5C400] px-2 py-0.5 font-bold text-[#0D1B4C]">
                {queueCount} Antrean
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {mode === "ppdb" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleRegisterPpdb} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Formulir Pendaftaran PPDB</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Lengkap Calon Siswa</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">NISN (Opsional)</label>
                  <input
                    value={nisn}
                    onChange={(e) => setNisn(e.target.value)}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Rata-rata Rapor</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={averageScore}
                    onChange={(e) => setAverageScore(e.target.value)}
                    placeholder="85.5"
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Asal Sekolah (SMP / MTs)</label>
                <input
                  required
                  value={originSchool}
                  onChange={(e) => setOriginSchool(e.target.value)}
                  placeholder="SMP Negeri 1 Pasir Sakti"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Pilihan Kompetensi Keahlian</label>
                <select
                  value={chosenMajor}
                  onChange={(e) => setChosenMajor(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                >
                  <option value="Teknik Kendaraan Ringan (TKR)">Teknik Kendaraan Ringan (TKR)</option>
                  <option value="Teknik dan Bisnis Sepeda Motor (TBSM)">Teknik dan Bisnis Sepeda Motor (TBSM)</option>
                  <option value="Teknik Komputer dan Jaringan (TKJ)">Teknik Komputer dan Jaringan (TKJ)</option>
                  <option value="Akuntansi dan Keuangan Lembaga (AKL)">Akuntansi dan Keuangan Lembaga (AKL)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">No. WhatsApp Orang Tua / Wali</label>
                <input
                  required
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy === "ppdb-submit"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "ppdb-submit" ? "Mendaftarkan..." : "Daftarkan Calon Siswa"}
              </button>
            </div>
          </form>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-bold text-[#0D1B4C]">Daftar Calon Peserta Didik ({applicants.length})</h2>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">Memuat data pendaftar...</p>
            ) : applicants.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada data pendaftar PPDB tahun ini.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2.5">No. Reg</th>
                      <th className="px-3 py-2.5">Nama & Asal Sekolah</th>
                      <th className="px-3 py-2.5">Jurusan</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Keputusan Panitia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {applicants.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2.5 font-mono text-xs font-bold text-[#0D1B4C]">{a.registrationNo}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{a.fullName}</div>
                          <div className="text-xs text-slate-500">
                            {a.originSchool} • WA: {a.parentPhone}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-700">{a.chosenMajor}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              a.status === "DITERIMA"
                                ? "bg-emerald-100 text-emerald-800"
                                : a.status === "TERVERIFIKASI"
                                  ? "bg-blue-100 text-blue-800"
                                  : a.status === "DITOLAK"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {a.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex gap-1.5">
                            {a.status === "MENDAFTAR" && (
                              <button
                                type="button"
                                disabled={busy === a.id}
                                onClick={() => handleUpdatePpdb(a.id, "TERVERIFIKASI")}
                                className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                Verifikasi
                              </button>
                            )}
                            {a.status !== "DITERIMA" && (
                              <button
                                type="button"
                                disabled={busy === a.id}
                                onClick={() => handleUpdatePpdb(a.id, "DITERIMA")}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Terima
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleSubmitReport} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Kirim Laporan Rahasia (Anonim)</h2>
            <p className="mt-1 text-xs text-slate-500">
              Identitas pelapor tidak direkam dalam database. Anda akan mendapatkan kode tiket pelacakan.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Kategori Laporan</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as WhistleblowerCategory)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                >
                  <option value="PERUNDUNGAN_BULLYING">Perundungan / Bullying</option>
                  <option value="KEKERASAN_FISIK_VERBAL">Kekerasan Fisik / Verbal</option>
                  <option value="FASILITAS_KEAMANAN">Keamanan Lingkungan / Bengkel</option>
                  <option value="LAINNYA">Lainnya</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Lokasi Kejadian (Opsional)</label>
                <input
                  value={incidentPlace}
                  onChange={(e) => setIncidentPlace(e.target.value)}
                  placeholder="Contoh: Area Kantin / Bengkel Belakang"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Kronologi Kejadian</label>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Jelaskan peristiwa yang terjadi secara jelas..."
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy === "report-submit"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "report-submit" ? "Mengirim..." : "Kirim Laporan Anonim"}
              </button>
              {lastTicket && (
                <div className="rounded-xl bg-amber-50 p-3 text-center text-xs font-bold text-amber-900">
                  Kode Tiket Anda: {lastTicket}
                </div>
              )}
            </div>
          </form>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-bold text-[#0D1B4C]">Kotak Masuk Satgas & Tindak Lanjut BK</h2>
            {reports.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada laporan masuk. Lingkungan sekolah terpantau aman.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {reports.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#0D1B4C]">{r.ticketCode}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          {r.category}
                        </span>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          r.status === "SELESAI"
                            ? "bg-emerald-100 text-emerald-800"
                            : r.status === "DITINDAKLANJUTI"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    {r.incidentPlace && (
                      <p className="mt-1 text-xs font-medium text-slate-500">Lokasi: {r.incidentPlace}</p>
                    )}
                    <p className="mt-2 text-sm text-slate-800">{r.description}</p>
                    {r.counselorReply && (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <strong>Tanggapan Satgas BK:</strong> {r.counselorReply}
                      </div>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      {r.status === "BARU" && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => handleUpdateReport(r.id, "DITINDAKLANJUTI")}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Tindak Lanjuti
                        </button>
                      )}
                      {r.status !== "SELESAI" && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => handleUpdateReport(r.id, "SELESAI")}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Tandai Selesai
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
