import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PayrollPeriodDto, PayrollSlipDto } from "@sims/shared";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PayrollPage({ mode }: { mode: "admin" | "employee" }) {
  const { schoolId } = useSchoolScope();
  const now = useMemo(() => new Date(), []);

  // Admin state
  const [periods, setPeriods] = useState<PayrollPeriodDto[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [slips, setSlips] = useState<PayrollSlipDto[]>([]);
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [ratePerJtm, setRatePerJtm] = useState<number>(35000);
  const [ratePerHadir, setRatePerHadir] = useState<number>(25000);
  const [notes, setNotes] = useState<string>("");

  // Employee state
  const [mySlips, setMySlips] = useState<PayrollSlipDto[]>([]);
  const [activeSlip, setActiveSlip] = useState<PayrollSlipDto | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    if (!schoolId || mode !== "admin") return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<PayrollPeriodDto[]>(`/api/v1/schools/${schoolId}/payroll/periods`);
      setPeriods(data);
      const firstPeriod = data[0];
      if (firstPeriod && !selectedPeriodId) {
        setSelectedPeriodId(firstPeriod.id);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat periode payroll.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, mode, selectedPeriodId]);

  const loadSlipsForPeriod = useCallback(async (periodId: string) => {
    if (!schoolId || !periodId || mode !== "admin") return;
    try {
      const data = await api<PayrollSlipDto[]>(`/api/v1/schools/${schoolId}/payroll/periods/${periodId}/slips`);
      setSlips(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat daftar slip gaji.");
    }
  }, [schoolId, mode]);

  const loadMySlips = useCallback(async () => {
    if (!schoolId || mode !== "employee") return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<PayrollSlipDto[]>(`/api/v1/schools/${schoolId}/payroll/my-slips`);
      setMySlips(data);
      const firstSlip = data[0];
      if (firstSlip) {
        setActiveSlip((prev) => prev ?? firstSlip);
      } else {
        setActiveSlip(null);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat riwayat slip gaji Anda.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, mode]);

  useEffect(() => {
    if (mode === "admin") {
      void loadPeriods();
    } else {
      void loadMySlips();
    }
  }, [mode, loadPeriods, loadMySlips]);

  useEffect(() => {
    if (mode === "admin" && selectedPeriodId) {
      void loadSlipsForPeriod(selectedPeriodId);
    }
  }, [mode, selectedPeriodId, loadSlipsForPeriod]);

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId || actionLock.current) return;
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2100) {
      setError("Bulan dan tahun periode tidak valid.");
      return;
    }
    if (!Number.isInteger(ratePerJtm) || ratePerJtm < 0 || !Number.isInteger(ratePerHadir) || ratePerHadir < 0) {
      setError("Tarif honor harus bilangan bulat dan tidak negatif.");
      return;
    }
    actionLock.current = true;
    setBusyAction("create-period");
    setError(null);
    setSuccess(null);
    try {
      const created = await api<PayrollPeriodDto>(`/api/v1/schools/${schoolId}/payroll/periods`, {
        method: "POST",
        body: JSON.stringify({
          month,
          year,
          ratePerJtm,
          ratePerHadir,
          notes: notes.trim() || undefined,
        }),
      });
      setNotes("");
      setSuccess(`Periode "${created.title}" berhasil dibuat.`);
      await loadPeriods();
      setSelectedPeriodId(created.id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal membuat periode gaji.");
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  }

  async function handleGenerateSlips() {
    if (!schoolId || !selectedPeriodId || actionLock.current) return;
    actionLock.current = true;
    setBusyAction("generate-slips");
    setError(null);
    setSuccess(null);
    try {
      const generated = await api<PayrollSlipDto[]>(
        `/api/v1/schools/${schoolId}/payroll/periods/${selectedPeriodId}/generate`,
        { method: "POST" }
      );
      setSlips(generated);
      setSuccess(`Berhasil menghitung otomatis ${generated.length} slip gaji dari rekap hadir & JTM.`);
      await loadPeriods();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal menghitung slip gaji.");
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  }

  async function handleUpdateSlipStatus(slipId: string, status: "DITERBITKAN" | "DIBAYAR") {
    if (!schoolId) return;
    setBusyAction(slipId);
    setError(null);
    setSuccess(null);
    try {
      await api<PayrollSlipDto>(`/api/v1/schools/${schoolId}/payroll/slips/${slipId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setSuccess(status === "DITERBITKAN" ? "Slip gaji diterbitkan ke portal guru." : "Slip gaji ditandai LUNAS / DIBAYAR.");
      if (selectedPeriodId) {
        await loadSlipsForPeriod(selectedPeriodId);
        await loadPeriods();
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memperbarui status slip.");
    } finally {
      setBusyAction(null);
    }
  }

  if (!schoolId) {
    return (
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-6 shadow-sm text-sm text-slate-600 shadow-sm">
        Pilih sekolah aktif terlebih dahulu untuk mengakses modul E-Payroll.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-gradient-to-br from-[#081236] via-[#0D1B4C] to-[#1D3587] p-6 shadow-xl shadow-[#0D1B4C]/15 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-[#F5C400]/20 px-3 py-1 text-xs font-semibold text-[#F5C400]">
              {mode === "admin" ? "KEUANGAN & KEPEGAWAIAN" : "PORTAL KESEJAHTERAAN PEGAWAI"}
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {mode === "admin" ? "E-Payroll & Penggajian Terpadu" : "Slip Gaji & Honor Digital"}
            </h1>
            <p className="mt-1 text-sm text-slate-200">
              {mode === "admin"
                ? "Kalkulasi otomatis honor Jam Tatap Muka (JTM), kehadiran pegawai, tunjangan jabatan, dan penerbitan slip."
                : "Rincian honor mengajar, kehadiran, tunjangan jabatan, serta unduh/cetak slip gaji resmi."}
            </p>
          </div>
          {mode === "employee" && activeSlip && (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-xl bg-[#F5C400] px-4 py-2.5 text-sm font-semibold text-[#0D1B4C] shadow-sm transition hover:bg-amber-400"
            >
              Cetak / Simpan PDF
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {mode === "admin" ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <form
              onSubmit={handleCreatePeriod}
              className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1"
            >
              <h2 className="text-base font-bold text-[#0D1B4C]">Buat Periode Penggajian</h2>
              <p className="mt-1 text-xs text-slate-500">Tetapkan tarif dasar per JTM dan tunjangan hadir bulanan.</p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Bulan</label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                  >
                    {MONTHS.map((label, idx) => (
                      <option key={label} value={idx + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Tahun</label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                    min={2024}
                    max={2100}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Tarif / JTM (Rp)</label>
                  <input
                    type="number"
                    value={ratePerJtm}
                    onChange={(e) => setRatePerJtm(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Uang Hadir / Hari (Rp)</label>
                  <input
                    type="number"
                    value={ratePerHadir}
                    onChange={(e) => setRatePerHadir(Number(e.target.value))}
                    className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                    min={0}
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs font-semibold text-slate-700">Catatan Periode (Opsional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Penggajian reguler semester ganjil"
                  className="mt-1 w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>

              <button
                type="submit"
                disabled={busyAction === "create-period"}
                className="mt-4 w-full flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D1B4C] to-[#1D3587] px-5 text-sm font-extrabold text-white shadow-lg shadow-[#0D1B4C]/20 transition hover:brightness-110 transition hover:bg-[#162466] disabled:opacity-50"
              >
                {busyAction === "create-period" ? "Menyimpan..." : "Tambah Periode Gaji"}
              </button>
            </form>

            <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#0D1B4C]">Daftar Periode Penggajian</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Pilih periode untuk menghitung atau menerbitkan slip.</p>
                </div>
                {selectedPeriodId && (
                  <button
                    type="button"
                    onClick={handleGenerateSlips}
                    disabled={busyAction === "generate-slips"}
                    className="rounded-xl bg-[#F5C400] px-4 py-2 text-xs font-bold text-[#0D1B4C] shadow-sm transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {busyAction === "generate-slips"
                      ? "Menghitung..."
                      : "Hitung Otomatis Slip (Rekap Hadir & JTM)"}
                  </button>
                )}
              </div>

              {loading ? (
                <p className="mt-4 text-sm text-slate-500">Memuat data periode...</p>
              ) : periods.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  Belum ada periode penggajian. Silakan buat periode baru di samping kiri.
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {periods.map((p) => {
                    const active = p.id === selectedPeriodId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPeriodId(p.id)}
                        className={`rounded-xl border p-4 text-left transition ${
                          active
                            ? "border-[#0D1B4C] bg-[#0D1B4C]/5 ring-1 ring-[#0D1B4C]"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#0D1B4C]">{p.title}</span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                            {p.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-slate-600">
                          Tarif: {formatRupiah(p.ratePerJtm)}/JTM • {formatRupiah(p.ratePerHadir)}/Hadir
                        </div>
                        <div className="mt-1 text-xs font-semibold text-emerald-700">
                          {p.slipCount ?? 0} Pegawai • Total: {formatRupiah(p.totalNetPay ?? 0)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#0D1B4C]">Rincian Slip Gaji Pegawai & Guru</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Terbitkan slip agar muncul di aplikasi HP guru/pegawai, lalu tandai dibayar setelah transfer selesai.
            </p>

            {slips.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Belum ada slip pada periode ini. Klik tombol &ldquo;Hitung Otomatis Slip&rdquo; di atas.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2.5">Nama Pegawai</th>
                      <th className="px-3 py-2.5">Peran</th>
                      <th className="px-3 py-2.5">Hadir / JTM</th>
                      <th className="px-3 py-2.5">Honor & Tunjangan</th>
                      <th className="px-3 py-2.5">Potongan</th>
                      <th className="px-3 py-2.5">Total Terima</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {slips.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-3 font-semibold text-slate-900">{s.employeeName}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{s.roleLabel}</td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          {s.totalHadirDays} hr • {s.totalJtmHours} JTM
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          <div>JTM: {formatRupiah(s.baseHonor)}</div>
                          <div>Hadir: {formatRupiah(s.attendanceBonus)}</div>
                          <div>Jabatan: {formatRupiah(s.positionBonus)}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-red-600">{formatRupiah(s.deductionAmount)}</td>
                        <td className="px-3 py-3 font-bold text-[#0D1B4C]">{formatRupiah(s.netPay)}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              s.status === "DIBAYAR"
                                ? "bg-emerald-100 text-emerald-800"
                                : s.status === "DITERBITKAN"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex gap-2">
                            {s.status === "DRAFT" && (
                              <button
                                type="button"
                                disabled={busyAction === s.id}
                                onClick={() => handleUpdateSlipStatus(s.id, "DITERBITKAN")}
                                className="rounded-lg bg-[#0D1B4C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162466]"
                              >
                                Terbitkan
                              </button>
                            )}
                            {s.status === "DITERBITKAN" && (
                              <button
                                type="button"
                                disabled={busyAction === s.id}
                                onClick={() => handleUpdateSlipStatus(s.id, "DIBAYAR")}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Tandai Dibayar
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
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1">
            <h2 className="text-base font-bold text-[#0D1B4C]">Riwayat Periode Slip</h2>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">Memuat slip gaji Anda...</p>
            ) : mySlips.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Belum ada slip gaji yang diterbitkan untuk akun Anda pada sekolah ini.
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {mySlips.map((slip) => {
                  const selected = activeSlip?.id === slip.id;
                  return (
                    <button
                      key={slip.id}
                      type="button"
                      onClick={() => setActiveSlip(slip)}
                      className={`w-full rounded-xl border p-3.5 text-left transition ${
                        selected
                          ? "border-[#0D1B4C] bg-[#0D1B4C]/5 ring-1 ring-[#0D1B4C]"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-[#0D1B4C]">
                          {slip.period?.title ?? "Slip Gaji Bulanan"}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {slip.status}
                        </span>
                      </div>
                      <div className="mt-1 text-base font-extrabold text-slate-900">
                        {formatRupiah(slip.netPay)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-[26px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-sm lg:col-span-2">
            {!activeSlip ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
                Pilih periode di samping kiri untuk melihat rincian slip gaji digital Anda.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      SLIP GAJI & HONOR DIGITAL — SAKTI-KU
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-[#0D1B4C]">
                      {activeSlip.period?.title ?? "Periode Penggajian"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Nama: <strong className="text-slate-900">{activeSlip.employeeName}</strong> ({activeSlip.roleLabel})
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                    {activeSlip.status}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">Rekap Kehadiran Pegawai</div>
                    <div className="mt-1 text-lg font-bold text-[#0D1B4C]">{activeSlip.totalHadirDays} Hari Hadir</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <div className="text-xs text-slate-500">Rekap Jam Tatap Muka (E-Jurnal)</div>
                    <div className="mt-1 text-lg font-bold text-[#0D1B4C]">{activeSlip.totalJtmHours} Sesi / JTM</div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  <div className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-slate-600">Honor Mengajar (JTM)</span>
                    <span className="font-semibold text-slate-900">{formatRupiah(activeSlip.baseHonor)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-slate-600">Tunjangan Kehadiran</span>
                    <span className="font-semibold text-slate-900">{formatRupiah(activeSlip.attendanceBonus)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-slate-600">Tunjangan Jabatan / Wali Kelas</span>
                    <span className="font-semibold text-slate-900">{formatRupiah(activeSlip.positionBonus)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 text-sm text-red-600">
                    <span>Potongan {activeSlip.deductionNote ? `(${activeSlip.deductionNote})` : ""}</span>
                    <span className="font-semibold">- {formatRupiah(activeSlip.deductionAmount)}</span>
                  </div>
                  <div className="flex justify-between bg-[#0D1B4C]/5 px-4 py-3.5 text-base font-extrabold text-[#0D1B4C]">
                    <span>Total Penerimaan Bersih (Take-Home Pay)</span>
                    <span>{formatRupiah(activeSlip.netPay)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
