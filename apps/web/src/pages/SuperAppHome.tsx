import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PayrollSlipDto } from "@sims/shared";
import { allJobTitles, isBendahara, isGuru, isKaprog, isKomite, isPrincipal, isSchoolAdmin, isStaff, isTu, isWakaHumas, isWakaKesiswaan, isWakaSarpras, isWakakur, isWali } from "../lib/access.ts";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { usePortal } from "../lib/portal.tsx";
import { useSchoolScope } from "../lib/school.tsx";

type QuickAppItem = {
  id: string;
  label: string;
  category: "Harian & KBM" | "Kesiswaan & Wali" | "Vokasi & Keuangan" | "Administrasi";
  to: string;
  gradient: string;
  iconColor: string;
  icon:
    | "journal"
    | "attendance"
    | "grade"
    | "leave"
    | "payroll"
    | "tools"
    | "bkk"
    | "more"
    | "bk"
    | "pkl"
    | "spp"
    | "wali"
    | "ppdb"
    | "safe"
    | "admin"
    | "rapor"
    | "schedule";
};

function greetingByHour(hour: number): string {
  if (hour < 11) return "Selamat Pagi";
  if (hour < 15) return "Selamat Siang";
  if (hour < 18) return "Selamat Sore";
  return "Selamat Malam";
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function AppSquircleIcon({ name, className }: { name: QuickAppItem["icon"]; className?: string }) {
  const c = className ?? "h-6 w-6";
  switch (name) {
    case "journal":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h6M9 11h4" /></svg>;
    case "attendance":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m16 11 2 2 4-4" /></svg>;
    case "grade":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>;
    case "leave":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" /></svg>;
    case "payroll":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>;
    case "tools":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>;
    case "bkk":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>;
    case "bk":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "pkl":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" /></svg>;
    case "spp":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
    case "wali":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "ppdb":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
    case "safe":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>;
    case "rapor":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
    case "schedule":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case "admin":
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    default:
      return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>;
  }
}

export function SuperAppHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { schoolId, schools } = useSchoolScope();
  const { portal, teachings, homerooms } = usePortal();

  const [showAmount, setShowAmount] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [latestSlip, setLatestSlip] = useState<PayrollSlipDto | null>(null);
  const [todayCheckIn, setTodayCheckIn] = useState<string | null>(null);

  const greeting = useMemo(() => greetingByHour(new Date().getHours()), []);
  const staff = isStaff(user, schoolId);
  const principal = isPrincipal(user, schoolId);
  const wakakur = isWakakur(user, schoolId);
  const schoolAdmin = isSchoolAdmin(user, schoolId) || isTu(user, schoolId);
  const kaprog = isKaprog(user, schoolId);
  const wakaKesiswaan = isWakaKesiswaan(user, schoolId);
  const wakaSarpras = isWakaSarpras(user, schoolId);
  const wakaHumas = isWakaHumas(user, schoolId);
  const bendahara = isBendahara(user, schoolId);
  const komite = isKomite(user, schoolId);
  const guru = isGuru(user, schoolId) || teachings.length > 0;
  const wali = isWali(user, schoolId) || homerooms.length > 0;
  const roleBadges = useMemo(() => allJobTitles(user, schoolId, teachings.length > 0, homerooms.length > 0), [user, schoolId, teachings.length, homerooms.length]);

  const loadQuickMetrics = useCallback(async () => {
    if (!schoolId) return;
    try {
      const slips = await api<PayrollSlipDto[]>(`/schools/${schoolId}/payroll/my-slips`);
      setLatestSlip(slips[0] ?? null);
    } catch { setLatestSlip(null); }
    try {
      const att = await api<Array<{ workDate: string; checkInAt: string | null }>>(`/schools/${schoolId}/hr-attendance`);
      const todayIso = new Date().toISOString().slice(0, 10);
      const row = att.find((r) => r.workDate.slice(0, 10) === todayIso);
      setTodayCheckIn(row?.checkInAt ? new Date(row.checkInAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB" : null);
    } catch { setTodayCheckIn(null); }
  }, [schoolId]);

  useEffect(() => { void loadQuickMetrics(); }, [loadQuickMetrics]);

  const catalog: Array<QuickAppItem & { visible: boolean; priority: number }> = useMemo(() => [
    // Pimpinan & Kurikulum
    { id: "pengesahan", label: "Pengesahan Rapor", category: "Administrasi", to: "/pengesahan-rapor", gradient: "from-amber-50 to-yellow-100 border-amber-200/70", iconColor: "text-amber-700", icon: "rapor", visible: principal, priority: principal ? 10 : 99 },
    { id: "tahun-pelajaran", label: "Tahun Pelajaran", category: "Administrasi", to: "/tahun-pelajaran", gradient: "from-amber-50 to-yellow-100 border-amber-200/70", iconColor: "text-amber-800", icon: "admin", visible: schoolAdmin || wakakur, priority: schoolAdmin || wakakur ? 8 : 99 },
    { id: "semester", label: "Semester", category: "Administrasi", to: "/semester", gradient: "from-sky-50 to-blue-100 border-sky-200/70", iconColor: "text-sky-800", icon: "schedule", visible: schoolAdmin || wakakur, priority: 37 },
    { id: "kalender-pendidikan", label: "Kalender Pendidikan", category: "Administrasi", to: "/kalender-pendidikan", gradient: "from-teal-50 to-emerald-100 border-teal-200/70", iconColor: "text-teal-800", icon: "schedule", visible: schoolAdmin || wakakur, priority: 37 },
    { id: "bidang-keahlian", label: "Bidang Keahlian", category: "Administrasi", to: "/bidang", gradient: "from-indigo-50 to-blue-100 border-indigo-200/70", iconColor: "text-indigo-800", icon: "admin", visible: schoolAdmin || wakakur, priority: 38 },
    { id: "program-keahlian", label: "Program Keahlian", category: "Administrasi", to: "/program", gradient: "from-indigo-50 to-violet-100 border-indigo-200/70", iconColor: "text-indigo-800", icon: "admin", visible: schoolAdmin || wakakur, priority: 39 },
    { id: "konsentrasi-keahlian", label: "Konsentrasi Keahlian", category: "Administrasi", to: "/konsentrasi", gradient: "from-violet-50 to-purple-100 border-violet-200/70", iconColor: "text-violet-800", icon: "admin", visible: schoolAdmin || wakakur, priority: 40 },
    { id: "mata-pelajaran", label: "Mata Pelajaran", category: "Administrasi", to: "/mata-pelajaran", gradient: "from-blue-50 to-indigo-100 border-blue-200/70", iconColor: "text-blue-700", icon: "admin", visible: wakakur || schoolAdmin, priority: wakakur ? 10 : 34 },
    { id: "kurikulum", label: "Kurikulum & Mapel", category: "Administrasi", to: "/kurikulum", gradient: "from-indigo-50 to-blue-100 border-indigo-200/70", iconColor: "text-indigo-700", icon: "admin", visible: wakakur || schoolAdmin, priority: wakakur ? 11 : 35 },
    { id: "wali-kelas-admin", label: "Atur Wali Kelas", category: "Administrasi", to: "/wali-kelas", gradient: "from-teal-50 to-emerald-100 border-teal-200/70", iconColor: "text-teal-700", icon: "admin", visible: wakakur || schoolAdmin, priority: wakakur ? 15 : 36 },
    { id: "penugasan", label: "Penugasan Guru", category: "Administrasi", to: "/penugasan", gradient: "from-sky-50 to-cyan-100 border-sky-200/70", iconColor: "text-sky-700", icon: "schedule", visible: wakakur || schoolAdmin, priority: wakakur ? 12 : 36 },
    { id: "kebijakan-nilai", label: "Kebijakan Nilai", category: "Administrasi", to: "/pengaturan-nilai", gradient: "from-violet-50 to-purple-100 border-violet-200/70", iconColor: "text-violet-700", icon: "grade", visible: wakakur, priority: wakakur ? 13 : 99 },
    { id: "validasi-rapor", label: "Validasi Rapor", category: "Administrasi", to: "/validasi-rapor", gradient: "from-emerald-50 to-teal-100 border-emerald-200/70", iconColor: "text-emerald-700", icon: "rapor", visible: wakakur || principal, priority: wakakur ? 14 : 15 },
    { id: "penerimaan-nilai", label: "Monitoring Nilai", category: "Administrasi", to: "/nilai/penerimaan", gradient: "from-blue-50 to-indigo-100 border-blue-200/70", iconColor: "text-blue-700", icon: "grade", visible: staff, priority: principal || wakakur ? 16 : 40 },
    // Admin & Keuangan
    { id: "siswa", label: "Data Siswa", category: "Administrasi", to: "/siswa", gradient: "from-blue-50 to-sky-100 border-blue-200/70", iconColor: "text-blue-700", icon: "wali", visible: staff, priority: schoolAdmin ? 10 : principal ? 25 : 50 },
    { id: "guru-data", label: "Data Guru", category: "Administrasi", to: "/guru", gradient: "from-indigo-50 to-violet-100 border-indigo-200/70", iconColor: "text-indigo-700", icon: "admin", visible: staff, priority: schoolAdmin ? 11 : principal ? 26 : 51 },
    { id: "kelas-data", label: "Data Kelas", category: "Administrasi", to: "/kelas", gradient: "from-cyan-50 to-teal-100 border-cyan-200/70", iconColor: "text-cyan-700", icon: "rapor", visible: staff, priority: schoolAdmin ? 12 : 52 },
    { id: "kenaikan-kelas", label: "Kenaikan & Lulus", category: "Administrasi", to: "/kenaikan-kelas", gradient: "from-violet-50 to-indigo-100 border-violet-200/70", iconColor: "text-violet-700", icon: "schedule", visible: schoolAdmin || wakakur, priority: schoolAdmin || wakakur ? 16 : 99 },
    { id: "payroll-admin", label: "Kelola Payroll", category: "Vokasi & Keuangan", to: "/keuangan/payroll", gradient: "from-emerald-50 to-teal-100 border-emerald-200/70", iconColor: "text-emerald-700", icon: "payroll", visible: bendahara || schoolAdmin, priority: bendahara ? 10 : schoolAdmin ? 13 : 99 },
    { id: "spp", label: "Keuangan SPP", category: "Vokasi & Keuangan", to: "/keuangan/spp", gradient: "from-amber-50 to-orange-100 border-amber-200/70", iconColor: "text-amber-700", icon: "spp", visible: bendahara || komite || schoolAdmin || principal, priority: bendahara || komite ? 11 : schoolAdmin ? 14 : 22 },
    { id: "ppdb", label: "PPDB Online", category: "Kesiswaan & Wali", to: "/ppdb", gradient: "from-rose-50 to-pink-100 border-rose-200/70", iconColor: "text-rose-700", icon: "ppdb", visible: wakaKesiswaan || schoolAdmin || principal, priority: wakaKesiswaan ? 11 : schoolAdmin ? 15 : 60 },
    { id: "pengguna", label: "Akun & Role", category: "Administrasi", to: "/pengguna", gradient: "from-slate-100 to-slate-200 border-slate-300/70", iconColor: "text-slate-700", icon: "admin", visible: schoolAdmin, priority: 55 },
    // Guru & KBM
    { id: "journal", label: "Jurnal Kelas", category: "Harian & KBM", to: "/guru/jurnal", gradient: "from-blue-50 to-indigo-100 border-blue-200/70", iconColor: "text-blue-700", icon: "journal", visible: guru, priority: guru ? 17 : 99 },
    { id: "absensi", label: "Absensi Siswa", category: "Harian & KBM", to: "/guru/absensi", gradient: "from-teal-50 to-emerald-100 border-teal-200/70", iconColor: "text-teal-700", icon: "attendance", visible: guru, priority: guru ? 18 : 99 },
    { id: "nilai", label: "Input Nilai", category: "Harian & KBM", to: "/guru/nilai", gradient: "from-indigo-50 to-violet-100 border-indigo-200/70", iconColor: "text-indigo-700", icon: "grade", visible: guru, priority: guru ? 19 : 99 },
    { id: "kelas-saya", label: "Kelas Saya", category: "Harian & KBM", to: "/guru/kelas", gradient: "from-sky-50 to-cyan-100 border-sky-200/70", iconColor: "text-sky-700", icon: "schedule", visible: guru, priority: guru ? 32 : 99 },
    // Wali Kelas & Kesiswaan
    { id: "rapor-wali", label: "Rapor Wali Kelas", category: "Kesiswaan & Wali", to: "/wali/persiapan-rapor", gradient: "from-purple-50 to-indigo-100 border-purple-200/70", iconColor: "text-purple-700", icon: "rapor", visible: wali, priority: wali ? 16 : 99 },
    { id: "wali-portal", label: "Portal Wali", category: "Kesiswaan & Wali", to: "/wali/portal", gradient: "from-indigo-50 to-violet-100 border-indigo-200/70", iconColor: "text-indigo-700", icon: "wali", visible: wali || principal, priority: wali ? 20 : 62 },
    { id: "bk", label: "Karakter & BK", category: "Kesiswaan & Wali", to: "/kesiswaan/karakter-bk", gradient: "from-rose-50 to-red-100 border-rose-200/70", iconColor: "text-rose-700", icon: "bk", visible: wakaKesiswaan || wali || guru || principal, priority: wakaKesiswaan ? 10 : wali ? 21 : 63 },
    { id: "pkl", label: "Prakerin / PKL", category: "Kesiswaan & Wali", to: "/kesiswaan/pkl", gradient: "from-sky-50 to-blue-100 border-sky-200/70", iconColor: "text-sky-700", icon: "pkl", visible: kaprog || wakaHumas || guru || wali || staff, priority: kaprog || wakaHumas ? 12 : 64 },
    { id: "safe", label: "Anti-Bullying", category: "Kesiswaan & Wali", to: "/kesiswaan/whistleblower", gradient: "from-red-50 to-orange-100 border-red-200/70", iconColor: "text-red-700", icon: "safe", visible: true, priority: 80 },
    // Harian Pegawai & Vokasi (Semua Pegawai)
    { id: "izin", label: "Izin & Cuti", category: "Harian & KBM", to: "/pegawai/izin", gradient: "from-purple-50 to-fuchsia-100 border-purple-200/70", iconColor: "text-purple-700", icon: "leave", visible: true, priority: 28 },
    { id: "slip", label: "Slip Gaji Saya", category: "Vokasi & Keuangan", to: "/pegawai/slip-gaji", gradient: "from-emerald-50 to-green-100 border-emerald-200/70", iconColor: "text-emerald-700", icon: "payroll", visible: true, priority: 29 },
    { id: "presensi", label: "Absen GPS", category: "Harian & KBM", to: "/pegawai/presensi", gradient: "from-blue-50 to-sky-100 border-blue-200/70", iconColor: "text-blue-700", icon: "attendance", visible: true, priority: 30 },
    { id: "tools", label: "Bengkel & Lab", category: "Vokasi & Keuangan", to: "/vokasi/inventaris", gradient: "from-cyan-50 to-sky-100 border-cyan-200/70", iconColor: "text-cyan-700", icon: "tools", visible: true, priority: kaprog || wakaSarpras ? 11 : 33 },
    { id: "bkk", label: "BKK & Alumni", category: "Vokasi & Keuangan", to: "/vokasi/bkk", gradient: "from-amber-50 to-yellow-100 border-amber-200/70", iconColor: "text-amber-700", icon: "bkk", visible: true, priority: kaprog || wakaHumas ? 13 : 34 },
    { id: "sop-kerja", label: "Alur & SOP Kerja", category: "Administrasi", to: "/sop-kerja", gradient: "from-navy-50 to-indigo-100 border-indigo-200/70", iconColor: "text-[#0D1B4C]", icon: "rapor", visible: true, priority: 24 },
  ], [principal, wakakur, schoolAdmin, staff, guru, wali, kaprog, wakaKesiswaan, wakaSarpras, wakaHumas, bendahara, komite]);

  const allServices = useMemo(() => catalog.filter((i) => i.visible).sort((a, b) => a.priority - b.priority), [catalog]);
  const primaryApps = useMemo(() => [
    ...allServices.slice(0, 7),
    { id: "more", label: "Semua Layanan", category: "Administrasi" as const, to: "#more", gradient: "from-slate-100 to-slate-200/80 border-slate-300/70", iconColor: "text-[#0D1B4C]", icon: "more" as const },
  ], [allServices]);
  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allServices;
    return allServices.filter(
      (item) => item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
  }, [allServices, searchQuery]);

  const categories: Array<QuickAppItem["category"]> = [
    "Harian & KBM",
    "Kesiswaan & Wali",
    "Vokasi & Keuangan",
    "Administrasi",
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* 1. Hero Status Card Premium ala Livin' / BRImo */}
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#081236] via-[#0D1B4C] to-[#1D3587] p-5 text-white shadow-xl shadow-[#0D1B4C]/20 sm:p-7">
        <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-[#F5C400]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-300">
              {greeting},
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {user?.name || "Pengguna"}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {roleBadges.map((badge, idx) => (
                <span key={badge} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-xs ${idx === 0 ? "border-[#F5C400]/40 bg-[#F5C400]/15 text-[#F5C400]" : "border-white/20 bg-white/10 text-slate-100"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${idx === 0 ? "bg-[#F5C400]" : "bg-sky-300"}`} />
                  <span>{badge}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/pegawai/presensi")}
              className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-gradient-to-r from-[#F5C400] to-amber-400 px-5 py-3 text-sm font-extrabold text-[#0D1B4C] shadow-lg shadow-amber-500/25 transition hover:brightness-105 active:scale-[0.98]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10Z" />
                <circle cx="12" cy="11" r="2.5" />
              </svg>
              <span>{todayCheckIn ? "Absen Pulang" : "Absen Masuk GPS"}</span>
            </button>
          </div>
        </div>

        {/* Glassmorphism Quick Metrics Bar */}
        <div className="relative mt-6 grid grid-cols-3 gap-3 rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-md sm:p-4">
          <div>
            <p className="text-[11px] font-medium text-slate-300">Presensi Hari Ini</p>
            <p className="mt-0.5 text-sm font-extrabold text-white sm:text-base">
              {todayCheckIn ?? "Belum Absen"}
            </p>
          </div>
          <div className="border-x border-white/15 px-3">
            <p className="text-[11px] font-medium text-slate-300">
              {teachings.length > 0 ? "Kelas Diampu" : wali ? "Kelas Wali" : "Jabatan Aktif"}
            </p>
            <p className="mt-0.5 text-sm font-extrabold text-white sm:text-base">
              {teachings.length > 0 ? `${teachings.length} Rombel` : wali ? `${homerooms.length} Rombel` : `${roleBadges.length} Peran`}
            </p>
          </div>
          <div className="pl-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-slate-300">Slip Gaji</p>
              <button
                type="button"
                onClick={() => setShowAmount((prev) => !prev)}
                aria-label="Tampilkan atau sembunyikan nominal"
                className="rounded-md p-0.5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showAmount ? (
                    <>
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </>
                  )}
                </svg>
              </button>
            </div>
            <p className="mt-0.5 text-sm font-extrabold text-[#F5C400] sm:text-base">
              {latestSlip
                ? showAmount
                  ? formatRupiah(latestSlip.netPay)
                  : "Rp •••••••"
                : "Belum Terbit"}
            </p>
          </div>
        </div>
      </section>

      {/* 2. Grid 8 Ikon Utama Bergradasi ala DANA / MyTelkomsel */}
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold text-[#0D1B4C]">Layanan Utama</h2>
            <p className="text-xs text-slate-500">Ketuk ikon untuk membuka aktivitas harian</p>
          </div>
          <Link
            to={guru ? "/guru/kelas" : wakakur ? "/kurikulum" : principal ? "/pengesahan-rapor" : "/siswa"}
            className="rounded-full bg-[#0D1B4C]/8 px-3.5 py-1.5 text-xs font-bold text-[#0D1B4C] transition hover:bg-[#0D1B4C]/15"
          >
            {guru ? "Jadwal Kelas →" : wakakur ? "Kurikulum →" : principal ? "Pengesahan →" : "Data Siswa →"}
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-x-2 gap-y-6 sm:gap-x-4">
          {primaryApps.map((item) => {
            const content = (
              <div className="group flex flex-col items-center text-center">
                <div
                  className={`flex h-15 w-15 items-center justify-center rounded-[20px] border bg-gradient-to-br ${item.gradient} ${item.iconColor} shadow-xs transition duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 sm:h-17 sm:w-17`}
                >
                  <AppSquircleIcon name={item.icon} className="h-7 w-7" />
                </div>
                <span className="mt-2.5 line-clamp-2 text-xs font-bold leading-tight text-slate-800 sm:text-[13px]">
                  {item.label}
                </span>
              </div>
            );

            if (item.to === "#more") {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setDrawerOpen(true);
                  }}
                  className="focus:outline-none"
                >
                  {content}
                </button>
              );
            }

            return (
              <Link key={item.id} to={item.to} className="focus:outline-none">
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      {/* 3. Kartu Layanan Terpadu Kesiswaan & Sekolah Aman */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/wali/portal"
          className="group flex items-center justify-between rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-[#0D1B4C]/30 hover:shadow-md"
        >
          <div>
            <span className="inline-block rounded-full bg-indigo-50 px-3 py-0.5 text-[11px] font-bold text-indigo-700">
              PORTAL WALI & SISWA
            </span>
            <h3 className="mt-2 text-base font-extrabold text-[#0D1B4C]">
              Kehadiran & Catatan Pembinaan
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Pantau rekap Hadir/Sakit/Izin/Alpa, status SPP, dan catatan pembinaan siswa terkini.
            </p>
          </div>
          <span className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 font-bold text-indigo-700 transition group-hover:bg-[#0D1B4C] group-hover:text-white">
            →
          </span>
        </Link>

        <Link
          to="/kesiswaan/whistleblower"
          className="group flex items-center justify-between rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-[#0D1B4C]/30 hover:shadow-md"
        >
          <div>
            <span className="inline-block rounded-full bg-rose-50 px-3 py-0.5 text-[11px] font-bold text-rose-700">
              SEKOLAH AMAN & RAMAH ANAK
            </span>
            <h3 className="mt-2 text-base font-extrabold text-[#0D1B4C]">
              Kanal Anti-Bullying (Anonim)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Laporkan perundungan atau kendala keamanan lingkungan sekolah secara rahasia.
            </p>
          </div>
          <span className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 font-bold text-rose-700 transition group-hover:bg-[#0D1B4C] group-hover:text-white">
            →
          </span>
        </Link>
      </section>

      {/* 4. Super-App Categorized Grid Bottom Sheet (Pengganti Gambar 2 yang kaku) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:items-center sm:p-6"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl sm:rounded-[32px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Handle & Header */}
            <div className="px-6 pt-3 pb-4">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-[#0D1B4C]">Semua Layanan SAKTI-Ku</h3>
                  <p className="text-xs text-slate-500">Pilih fitur berdasarkan kategori atau cari cepat</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200"
                >
                  ✕
                </button>
              </div>

              {/* Instant Search Input */}
              <div className="relative mt-4">
                <svg
                  className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari layanan (misal: Jurnal, PKL, SPP, Rapor, PPDB)..."
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pr-4 pl-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1B4C] focus:bg-white"
                />
              </div>
            </div>

            {/* Categorized Icon Grid */}
            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-8">
              {categories.map((cat) => {
                const items = filteredServices.filter((s) => s.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <h4 className="mb-3 text-xs font-extrabold tracking-wider text-slate-400 uppercase">
                      {cat}
                    </h4>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {items.map((item) => (
                        <Link
                          key={item.id}
                          to={item.to}
                          onClick={() => setDrawerOpen(false)}
                          className="group flex flex-col items-center rounded-2xl border border-transparent p-2.5 text-center transition hover:border-slate-200 hover:bg-slate-50"
                        >
                          <div
                            className={`flex h-13 w-13 items-center justify-center rounded-2xl border bg-gradient-to-br ${item.gradient} ${item.iconColor} shadow-2xs transition group-hover:scale-105`}
                          >
                            <AppSquircleIcon name={item.icon} className="h-6 w-6" />
                          </div>
                          <span className="mt-2 line-clamp-2 text-xs font-bold leading-tight text-slate-800">
                            {item.label}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}

              {filteredServices.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                  Tidak ada layanan yang cocok dengan kata kunci &ldquo;{searchQuery}&rdquo;.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
