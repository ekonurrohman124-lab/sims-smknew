import { useCallback, useEffect, useState } from "react";
import type { AlumniTracerDto, BkkJobPostDto, ToolLoanDto, WorkshopToolDto } from "@sims/shared";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

export function VokasiPage({ mode }: { mode: "inventaris" | "bkk" }) {
  const { schoolId } = useSchoolScope();
  const [tab, setTab] = useState<"primary" | "secondary">("primary");

  // Inventaris & Peminjaman Alat state
  const [tools, setTools] = useState<WorkshopToolDto[]>([]);
  const [loans, setLoans] = useState<ToolLoanDto[]>([]);
  const [assetCode, setAssetCode] = useState("");
  const [toolName, setToolName] = useState("");
  const [labName, setLabName] = useState("");
  const [totalQty, setTotalQty] = useState(1);
  const [condition, setCondition] = useState<"BAIK" | "PERLU_PERBAIKAN" | "RUSAK">("BAIK");

  const [loanToolId, setLoanToolId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerRole, setBorrowerRole] = useState("Siswa XII TKJ");
  const [loanQty, setLoanQty] = useState(1);
  const [loanPurpose, setLoanPurpose] = useState("");

  // BKK & Tracer Study state
  const [jobs, setJobs] = useState<BkkJobPostDto[]>([]);
  const [tracers, setTracers] = useState<AlumniTracerDto[]>([]);
  const [graduatedStudents, setGraduatedStudents] = useState<Array<{ id: string; name: string; nisn: string; concentrationName?: string | null; className?: string | null; isActive?: boolean }>>([]);
  const [yearFilter, setYearFilter] = useState("ALL");
  const [majorFilter, setMajorFilter] = useState("ALL");
  const [companyName, setCompanyName] = useState("");
  const [positionTitle, setPositionTitle] = useState("");
  const [location, setLocation] = useState("");
  const [majorTarget, setMajorTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [contactInfo, setContactInfo] = useState("");

  const [alumniName, setAlumniName] = useState("");
  const [tracerStudentId, setTracerStudentId] = useState<string | null>(null);
  const [graduationYear, setGraduationYear] = useState(new Date().getFullYear());
  const [majorName, setMajorName] = useState("");
  const [tracerStatus, setTracerStatus] = useState<"BEKERJA" | "WIRAUSAHA" | "KULIAH" | "BELUM_BEKERJA">("BEKERJA");
  const [institutionName, setInstitutionName] = useState("");
  const [positionOrStudy, setPositionOrStudy] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadInventaris = useCallback(async () => {
    if (!schoolId || mode !== "inventaris") return;
    setLoading(true);
    setError(null);
    try {
      const [toolList, loanList] = await Promise.all([
        api<WorkshopToolDto[]>(`/api/v1/schools/${schoolId}/vokasi/tools`),
        api<ToolLoanDto[]>(`/api/v1/schools/${schoolId}/vokasi/tool-loans`),
      ]);
      setTools(toolList);
      setLoans(loanList);
      const firstTool = toolList[0];
      if (firstTool && !loanToolId) {
        setLoanToolId(firstTool.id);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat inventaris bengkel/lab.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, mode, loanToolId]);

  const loadBkk = useCallback(async () => {
    if (!schoolId || mode !== "bkk") return;
    setLoading(true);
    setError(null);
    try {
      const [jobList, tracerList] = await Promise.all([
        api<BkkJobPostDto[]>(`/api/v1/schools/${schoolId}/vokasi/bkk-jobs`),
        api<AlumniTracerDto[]>(`/api/v1/schools/${schoolId}/vokasi/tracer-study`),
      ]);
      const students: Array<{ id: string; name: string; nisn: string; concentrationName?: string | null; className?: string | null; isActive?: boolean }> = [];
      let page = 1;
      let total = 0;
      do {
        const studentRes = await api<{ items: typeof students; total: number }>(`/api/v1/schools/${schoolId}/students?page=${page}&pageSize=50`);
        students.push(...studentRes.items);
        total = studentRes.total;
        page += 1;
      } while (students.length < total && page <= 100);
      setJobs(jobList);
      setTracers(tracerList);
      const tracedStudentIds = new Set(tracerList.flatMap((tracer) => tracer.studentId ? [tracer.studentId] : []));
      setGraduatedStudents(students.filter((st) => (st.isActive === false || !st.className) && !tracedStudentIds.has(st.id)));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat data BKK & Tracer Study.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, mode]);

  useEffect(() => {
    setTab("primary");
    setError(null);
    setSuccess(null);
    if (mode === "inventaris") {
      void loadInventaris();
    } else {
      void loadBkk();
    }
  }, [mode, loadInventaris, loadBkk]);

  async function handleAddTool(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setBusy("add-tool");
    setError(null);
    setSuccess(null);
    try {
      await api<WorkshopToolDto>(`/api/v1/schools/${schoolId}/vokasi/tools`, {
        method: "POST",
        body: JSON.stringify({ assetCode, name: toolName, labName, totalQty, condition }),
      });
      setAssetCode("");
      setToolName("");
      setTotalQty(1);
      setSuccess("Aset/alat bengkel berhasil didaftarkan.");
      await loadInventaris();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal menambahkan alat praktik.");
    } finally {
      setBusy(null);
    }
  }

  async function handleBorrowTool(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId || !loanToolId) return;
    setBusy("borrow-tool");
    setError(null);
    setSuccess(null);
    try {
      await api<ToolLoanDto>(`/api/v1/schools/${schoolId}/vokasi/tool-loans`, {
        method: "POST",
        body: JSON.stringify({
          toolId: loanToolId,
          borrowerName,
          borrowerRole,
          qty: loanQty,
          purpose: loanPurpose.trim() || undefined,
        }),
      });
      setBorrowerName("");
      setLoanPurpose("");
      setLoanQty(1);
      setSuccess("Peminjaman alat praktik berhasil dicatat.");
      await loadInventaris();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal mencatat peminjaman alat.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReturnLoan(loanId: string) {
    if (!schoolId) return;
    setBusy(loanId);
    setError(null);
    setSuccess(null);
    try {
      await api<ToolLoanDto>(`/api/v1/schools/${schoolId}/vokasi/tool-loans/${loanId}/return`, { method: "POST" });
      setSuccess("Alat praktik berhasil dikembalikan dan stok diperbarui.");
      await loadInventaris();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memproses pengembalian alat.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setBusy("add-job");
    setError(null);
    setSuccess(null);
    try {
      await api<BkkJobPostDto>(`/api/v1/schools/${schoolId}/vokasi/bkk-jobs`, {
        method: "POST",
        body: JSON.stringify({
          companyName,
          positionTitle,
          location,
          majorTarget: majorTarget.trim() || undefined,
          deadline: deadline || undefined,
          description,
          contactInfo: contactInfo.trim() || undefined,
        }),
      });
      setCompanyName("");
      setPositionTitle("");
      setLocation("");
      setMajorTarget("");
      setDeadline("");
      setDescription("");
      setContactInfo("");
      setSuccess("Lowongan kerja mitra BKK berhasil diterbitkan.");
      await loadBkk();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal menerbitkan lowongan kerja.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateTracer(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setBusy("add-tracer");
    setError(null);
    setSuccess(null);
    try {
      await api<AlumniTracerDto>(`/api/v1/schools/${schoolId}/vokasi/tracer-study`, {
        method: "POST",
        body: JSON.stringify({
          studentId: tracerStudentId ?? undefined,
          alumniName,
          graduationYear,
          majorName,
          status: tracerStatus,
          institutionName: institutionName.trim() || undefined,
          positionOrStudy: positionOrStudy.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      setTracerStudentId(null);
      setAlumniName("");
      setInstitutionName("");
      setPositionOrStudy("");
      setPhone("");
      setSuccess("Data Tracer Study alumni berhasil disimpan.");
      await loadBkk();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal menyimpan data tracer alumni.");
    } finally {
      setBusy(null);
    }
  }

  if (!schoolId) {
    return (
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-6 shadow-sm text-sm text-slate-600 shadow-sm">
        Pilih sekolah aktif terlebih dahulu untuk mengakses modul Ekosistem Vokasi SMK.
      </div>
    );
  }

  const absorbedCount = tracers.filter((t) => t.status !== "BELUM_BEKERJA").length;
  const absorptionRate = tracers.length > 0 ? Math.round((absorbedCount / tracers.length) * 100) : 0;
  const yearsList = Array.from(new Set(tracers.map((t) => String(t.graduationYear)))).sort((a, b) => Number(b) - Number(a));
  const majorsList = Array.from(new Set(tracers.map((t) => t.majorName.trim()).filter(Boolean))).sort();
  const filteredTracers = tracers.filter((t) => (yearFilter === "ALL" || String(t.graduationYear) === yearFilter) && (majorFilter === "ALL" || t.majorName.trim() === majorFilter));

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-br from-[#081236] via-[#0D1B4C] to-[#1D3587] p-6 shadow-xl shadow-[#0D1B4C]/15 text-white shadow-md">
        <span className="inline-block rounded-full bg-[#F5C400]/20 px-3 py-1 text-xs font-semibold text-[#F5C400]">
          EKOSISTEM KHAS VOKASI SMK
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {mode === "inventaris"
            ? "Manajemen Bengkel, Lab & Inventaris Alat"
            : "Bursa Kerja Khusus (BKK) & Tracer Study Alumni"}
        </h1>
        <p className="mt-1 text-sm text-slate-200">
          {mode === "inventaris"
            ? "Kendali aset barcode alat praktik jurusan dan peminjaman bengkel secara real-time."
            : "Portal lowongan mitra industri (DUDI) dan pemetaan keterserapan lulusan (BMW: Bekerja, Melanjutkan, Wirausaha)."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("primary")}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              tab === "primary" ? "bg-[#F5C400] text-[#0D1B4C]" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {mode === "inventaris" ? `Katalog Alat (${tools.length})` : `Info Lowongan DUDI (${jobs.length})`}
          </button>
          <button
            type="button"
            onClick={() => setTab("secondary")}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              tab === "secondary" ? "bg-[#F5C400] text-[#0D1B4C]" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {mode === "inventaris"
              ? `Peminjaman Alat (${loans.filter((l) => l.status === "DIPINJAM").length} Aktif)`
              : `Tracer Study Alumni (${absorptionRate}% Terserap)`}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {mode === "inventaris" && tab === "primary" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleAddTool} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Tambah Aset / Alat Praktik</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Kode Barcode / Aset</label>
                <input
                  required
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                  placeholder="Contoh: TKR-KNC-001"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Alat / Perangkat</label>
                <input
                  required
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="Contoh: Kunci Torsi Digital 1/2 Inch"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Bengkel / Ruang Lab</label>
                <input
                  required
                  value={labName}
                  onChange={(e) => setLabName(e.target.value)}
                  placeholder="Contoh: Bengkel Otomotif / Lab TKJ"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Jumlah Unit</label>
                  <input
                    type="number"
                    min={1}
                    value={totalQty}
                    onChange={(e) => setTotalQty(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Kondisi</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as "BAIK" | "PERLU_PERBAIKAN" | "RUSAK")}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  >
                    <option value="BAIK">BAIK</option>
                    <option value="PERLU_PERBAIKAN">PERLU PERBAIKAN</option>
                    <option value="RUSAK">RUSAK</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={busy === "add-tool"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "add-tool" ? "Menyimpan..." : "Simpan Aset Alat"}
              </button>
            </div>
          </form>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-bold text-[#0D1B4C]">Daftar Inventaris Alat Praktik</h2>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">Memuat katalog alat...</p>
            ) : tools.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada alat praktik yang terdaftar.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2.5">Kode</th>
                      <th className="px-3 py-2.5">Nama Alat</th>
                      <th className="px-3 py-2.5">Bengkel / Lab</th>
                      <th className="px-3 py-2.5">Stok Tersedia</th>
                      <th className="px-3 py-2.5">Kondisi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tools.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2.5 font-mono text-xs font-bold text-[#0D1B4C]">{t.assetCode}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">{t.name}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{t.labName}</td>
                        <td className="px-3 py-2.5 font-semibold text-emerald-700">
                          {t.availableQty} / {t.totalQty} unit
                        </td>
                        <td className="px-3 py-2.5 text-xs">{t.condition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "inventaris" && tab === "secondary" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleBorrowTool} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Catat Peminjaman Alat</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Pilih Alat Praktik</label>
                <select
                  required
                  value={loanToolId}
                  onChange={(e) => setLoanToolId(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                >
                  <option value="">-- Pilih Alat --</option>
                  {tools.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.assetCode}] {t.name} (Sisa: {t.availableQty})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Peminjam</label>
                <input
                  required
                  value={borrowerName}
                  onChange={(e) => setBorrowerName(e.target.value)}
                  placeholder="Nama Siswa / Guru Praktik"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Kelas / Jabatan</label>
                  <input
                    required
                    value={borrowerRole}
                    onChange={(e) => setBorrowerRole(e.target.value)}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Jumlah</label>
                  <input
                    type="number"
                    min={1}
                    value={loanQty}
                    onChange={(e) => setLoanQty(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Keperluan Praktik</label>
                <input
                  value={loanPurpose}
                  onChange={(e) => setLoanPurpose(e.target.value)}
                  placeholder="Contoh: Praktik Tune-Up Mesin EFI"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy === "borrow-tool"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "borrow-tool" ? "Memproses..." : "Pinjamkan Alat"}
              </button>
            </div>
          </form>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-bold text-[#0D1B4C]">Log Peminjaman & Pengembalian</h2>
            {loans.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada riwayat peminjaman alat bengkel.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2.5">Alat</th>
                      <th className="px-3 py-2.5">Peminjam</th>
                      <th className="px-3 py-2.5">Qty</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loans.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{l.tool?.name}</div>
                          <div className="text-xs text-slate-500">{l.tool?.assetCode}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{l.borrowerName}</div>
                          <div className="text-xs text-slate-500">{l.borrowerRole}</div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold">{l.qty}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              l.status === "DIPINJAM"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {l.status === "DIPINJAM" && (
                            <button
                              type="button"
                              disabled={busy === l.id}
                              onClick={() => handleReturnLoan(l.id)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              Kembalikan
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "bkk" && tab === "primary" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleCreateJob} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Terbitkan Lowongan Kerja BKK</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Perusahaan / DUDI</label>
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Contoh: PT Astra Honda Motor"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Posisi / Lowongan</label>
                <input
                  required
                  value={positionTitle}
                  onChange={(e) => setPositionTitle(e.target.value)}
                  placeholder="Contoh: Teknisi Servis & Quality Control"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Lokasi Penempatan</label>
                  <input
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Lampung / Cikarang"
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Batas Lamaran</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Target Kompetensi Keahlian</label>
                <input
                  value={majorTarget}
                  onChange={(e) => setMajorTarget(e.target.value)}
                  placeholder="TKR, TBSM, TKJ, Semua Jurusan"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Persyaratan & Deskripsi</label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Kontak / Link Pendaftaran BKK</label>
                <input
                  value={contactInfo}
                  onChange={(e) => setContactInfo(e.target.value)}
                  placeholder="WA BKK: 0812-xxxx / Ruang BKK"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy === "add-job"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "add-job" ? "Menerbitkan..." : "Publikasikan Lowongan"}
              </button>
            </div>
          </form>

          <div className="space-y-3 lg:col-span-2">
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Belum ada lowongan kerja yang dipublikasikan oleh BKK.
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="rounded-full bg-[#0D1B4C]/10 px-2.5 py-0.5 text-xs font-bold text-[#0D1B4C]">
                        {job.companyName}
                      </span>
                      <h3 className="mt-1.5 text-lg font-bold text-slate-900">{job.positionTitle}</h3>
                      <p className="text-xs text-slate-500">
                        Lokasi: {job.location} {job.majorTarget ? `• Jurusan: ${job.majorTarget}` : ""}{" "}
                        {job.deadline ? `• Tutup: ${job.deadline}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{job.description}</p>
                  {job.contactInfo && (
                    <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      Info Pendaftaran: {job.contactInfo}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {mode === "bkk" && tab === "secondary" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleCreateTracer} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Input Tracer Study Alumni</h2>
            {graduatedStudents.length > 0 && (
              <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                <p className="text-[11px] font-bold text-[#0D1B4C]">Lulusan SOP-01 Belum Di-Tracer ({graduatedStudents.length}):</p>
                <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {graduatedStudents.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setTracerStudentId(st.id);
                        setAlumniName(st.name);
                        if (st.concentrationName) setMajorName(st.concentrationName);
                        setGraduationYear(new Date().getFullYear());
                      }}
                      className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0D1B4C] shadow-2xs hover:bg-[#0D1B4C] hover:text-white"
                    >
                      + {st.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Lengkap Alumni</label>
                <input
                  required
                  value={alumniName}
                  onChange={(e) => {
                    setAlumniName(e.target.value);
                    setTracerStudentId(null);
                  }}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Tahun Lulus</label>
                  <input
                    type="number"
                    required
                    value={graduationYear}
                    onChange={(e) => setGraduationYear(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Kompetensi Keahlian</label>
                  <input
                    required
                    value={majorName}
                    onChange={(e) => setMajorName(e.target.value)}
                    placeholder="TKR / TKJ / AKL"
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Status Kebekerjaan (BMW)</label>
                <select
                  value={tracerStatus}
                  onChange={(e) =>
                    setTracerStatus(e.target.value as "BEKERJA" | "WIRAUSAHA" | "KULIAH" | "BELUM_BEKERJA")
                  }
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                >
                  <option value="BEKERJA">BEKERJA DI INDUSTRI</option>
                  <option value="WIRAUSAHA">BERWIRAUSAHA / UMKM</option>
                  <option value="KULIAH">MELANJUTKAN KULIAH</option>
                  <option value="BELUM_BEKERJA">MENCARI KERJA</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nama Perusahaan / Kampus / Usaha</label>
                <input
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Jabatan / Program Studi</label>
                <input
                  value={positionOrStudy}
                  onChange={(e) => setPositionOrStudy(e.target.value)}
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={busy === "add-tracer"}
                className="w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 hover:bg-[#162466]"
              >
                {busy === "add-tracer" ? "Menyimpan..." : "Simpan Data Tracer"}
              </button>
            </div>
          </form>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#0D1B4C]">Direktori & Rekap Alumni Lintas Angkatan</h2>
              <div className="flex flex-wrap gap-2">
                <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                  <option value="ALL">Semua Angkatan</option>
                  {yearsList.map((y) => <option key={y} value={y}>Angkatan {y}</option>)}
                </select>
                <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                  <option value="ALL">Semua Jurusan</option>
                  {majorsList.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-emerald-50 p-2.5 text-center"><p className="text-lg font-extrabold text-emerald-800">{tracers.filter((t) => t.status === "BEKERJA").length}</p><p className="text-[11px] font-semibold text-emerald-700">Bekerja</p></div>
              <div className="rounded-xl bg-amber-50 p-2.5 text-center"><p className="text-lg font-extrabold text-amber-800">{tracers.filter((t) => t.status === "WIRAUSAHA").length}</p><p className="text-[11px] font-semibold text-amber-700">Wirausaha</p></div>
              <div className="rounded-xl bg-sky-50 p-2.5 text-center"><p className="text-lg font-extrabold text-sky-800">{tracers.filter((t) => t.status === "KULIAH").length}</p><p className="text-[11px] font-semibold text-sky-700">Kuliah</p></div>
              <div className="rounded-xl bg-slate-100 p-2.5 text-center"><p className="text-lg font-extrabold text-slate-800">{tracers.filter((t) => t.status === "BELUM_BEKERJA").length}</p><p className="text-[11px] font-semibold text-slate-600">Mencari Kerja</p></div>
            </div>
            {tracers.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada data Tracer Study alumni yang tercatat.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2.5">Nama Alumni</th>
                      <th className="px-3 py-2.5">Angkatan / Jurusan</th>
                      <th className="px-3 py-2.5">Status BMW</th>
                      <th className="px-3 py-2.5">Instansi / Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTracers.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">{t.alumniName}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {t.graduationYear} • {t.majorName}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              t.status === "BELUM_BEKERJA"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-700">
                          {t.institutionName || "-"} {t.positionOrStudy ? `(${t.positionOrStudy})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
