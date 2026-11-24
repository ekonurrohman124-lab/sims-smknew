import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { academicNavItems, showsAcademicGroup, usesWakakurAcademicNav } from "../../lib/academicNav.ts";
import { canCoordinate, isPrincipal, isSchoolAdmin, isWakakur } from "../../lib/access.ts";
import { useAuth } from "../../lib/auth.tsx";
import type { PortalId } from "../../lib/portal.tsx";
import { usePortal } from "../../lib/portal.tsx";
import { useSchoolScope } from "../../lib/school.tsx";

type IconName = "home" | "school" | "book" | "curriculum" | "data" | "class" | "learn" | "score" | "task" | "user";

type Leaf = { kind: "link"; to: string; label: string; end?: boolean } | { kind: "soon"; label: string };

type Group = { id: string; label: string; icon: IconName; items: Leaf[] };

const PORTAL_LABEL: Record<PortalId, string> = {
  admin: "Administrasi",
  guru: "Guru Mapel",
  wali: "Wali Kelas",
};

function Icon({ name }: { name: IconName }) {
  const common = "h-5 w-5 shrink-0";
  if (name === "home") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
  }
  if (name === "school") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10 12 4l9 6M5 10v9h14v-9M10 19v-5h4v5" /></svg>;
  }
  if (name === "book") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5zM5 5.5V21" /></svg>;
  }
  if (name === "curriculum") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 4h10v16H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 8h8M8 12h8M8 16h5" /></svg>;
  }
  if (name === "data") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>;
  }
  if (name === "class") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16v12H4zM8 6V4h8v2M8 12h8" /></svg>;
  }
  if (name === "learn") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8 12 4l9 4-9 4zM7 11v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4" /></svg>;
  }
  if (name === "score") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 19V9M12 19V5M19 19v-7" /></svg>;
  }
  if (name === "task") {
    return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 4h8v3H8zM6 7h12v13H6zM9 12h6M9 16h4" /></svg>;
  }
  return <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3" /><path d="M5 19c1.5-3 3.8-4.5 7-4.5S17.5 16 19 19" /></svg>;
}

function adminGroups(showImport: boolean, showPolicy: boolean, showUsers: boolean, showValidation: boolean, showEndorsement: boolean): Group[] {
  return [
    { id: "beranda", label: "Dashboard", icon: "home", items: [{ kind: "link", to: "/", label: "Beranda", end: true }] },
    ...(showUsers
      ? [{ id: "administrasi", label: "Administrasi", icon: "user" as const, items: [{ kind: "link" as const, to: "/pengguna", label: "Manajemen Pengguna" }] }]
      : []),
    {
      id: "sekolah",
      label: "Manajemen Sekolah",
      icon: "school",
      items: [
        { kind: "link", to: "/profil", label: "Profil Sekolah" },
        { kind: "link", to: "/tahun-pelajaran", label: "Tahun Pelajaran" },
        { kind: "link", to: "/semester", label: "Semester" },
        { kind: "link", to: "/keuangan/payroll", label: "Keuangan & E-Payroll" },
        { kind: "link", to: "/vokasi/inventaris", label: "Bengkel & Inventaris Alat" },
        { kind: "link", to: "/vokasi/bkk", label: "BKK & Tracer Study" },
        { kind: "link", to: "/ppdb", label: "PPDB Online" },
        { kind: "link", to: "/kesiswaan/whistleblower", label: "Anti-Bullying (Anonim)" },
      { kind: "link", to: "/ppdb", label: "PPDB Online" },
      { kind: "link", to: "/kesiswaan/whistleblower", label: "Anti-Bullying (Anonim)" },
      ],
    },
    {
      id: "master",
      label: "Master Akademik",
      icon: "book",
      items: [
        { kind: "link", to: "/bidang", label: "Bidang Keahlian" },
        { kind: "link", to: "/program", label: "Program Keahlian" },
        { kind: "link", to: "/konsentrasi", label: "Konsentrasi Keahlian" },
        { kind: "link", to: "/guru", label: "Guru" },
        { kind: "link", to: "/siswa", label: "Siswa" },
        { kind: "link", to: "/kelas", label: "Kelas" },
        { kind: "link", to: "/mapel", label: "Mata Pelajaran" },
      ],
    },
    {
      id: "kurikulum",
      label: "Kurikulum",
      icon: "curriculum",
      items: [
        { kind: "link", to: "/kurikulum", label: "Kurikulum" },
        ...(showPolicy ? [{ kind: "link" as const, to: "/pengaturan-nilai", label: "Pengaturan Nilai" }] : []),
        ...(showPolicy ? [{ kind: "link" as const, to: "/pengaturan-absensi", label: "Kelengkapan Absensi" }] : []),
        { kind: "link", to: "/pembelajaran", label: "TP & Lingkup Materi" },
        { kind: "link", to: "/penugasan", label: "Penugasan Mengajar" },
        { kind: "link", to: "/wali-kelas", label: "Wali Kelas" },
        { kind: "link", to: "/nilai/penerimaan", label: "Penerimaan Nilai" },
        ...(showValidation ? [{ kind: "link" as const, to: "/validasi-rapor", label: "Validasi Rapor" }] : []),
        ...(showEndorsement ? [{ kind: "link" as const, to: "/pengesahan-rapor", label: "Pengesahan Rapor" }] : []),
      ],
    },
    ...(showImport
      ? [{ id: "data", label: "Manajemen Data", icon: "data" as const, items: [{ kind: "link" as const, to: "/impor", label: "Impor Data" }] }]
      : []),
  ];
}

function placeAcademicGroup(groups: Group[], academicItems: Leaf[]): Group[] {
  if (academicItems.length === 0 || groups.some((group) => group.id === "akademik")) return groups;
  const paths = new Set(academicItems.flatMap((item) => (item.kind === "link" ? [item.to] : [])));
  const stripped = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.kind !== "link" || !paths.has(item.to)) }))
    .filter((group) => group.items.length > 0);
  const akademik: Group = { id: "akademik", label: "Akademik", icon: "book", items: academicItems };
  const afterSchool = stripped.findIndex((group) => group.id === "sekolah");
  const index = afterSchool >= 0 ? afterSchool + 1 : 1;
  return [...stripped.slice(0, index), akademik, ...stripped.slice(index)];
}

function wakakurGroups(showPolicy: boolean, academicItems: Leaf[]): Group[] {
  const groups: Group[] = [
    { id: "beranda", label: "Dashboard", icon: "home", items: [{ kind: "link", to: "/", label: "Beranda", end: true }] },
  ];
  if (academicItems.length > 0) {
    groups.push({ id: "akademik", label: "Akademik", icon: "book", items: academicItems });
  }
  groups.push({
    id: "kurikulum",
    label: "Kurikulum",
    icon: "curriculum",
    items: [
      { kind: "link", to: "/kurikulum", label: "Kurikulum" },
      ...(showPolicy ? [{ kind: "link" as const, to: "/pengaturan-nilai", label: "Pengaturan Nilai" }] : []),
      ...(showPolicy ? [{ kind: "link" as const, to: "/pengaturan-absensi", label: "Kelengkapan Absensi" }] : []),
      { kind: "link", to: "/pembelajaran", label: "TP & Lingkup Materi" },
      { kind: "link", to: "/wali-kelas", label: "Wali Kelas" },
      { kind: "link", to: "/nilai/penerimaan", label: "Penerimaan Nilai" },
      { kind: "link", to: "/validasi-rapor", label: "Validasi Rapor" },
    ],
  });
  return groups;
}

const guruGroups: Group[] = [
  { id: "guru-beranda", label: "Beranda", icon: "home", items: [{ kind: "link", to: "/guru/beranda", label: "Dashboard Guru", end: true }] },
  {
    id: "guru-ajar",
    label: "Pembelajaran",
    icon: "learn",
    items: [
      { kind: "link", to: "/guru/kelas", label: "Kelas Saya" },
      { kind: "link", to: "/kalender-pendidikan", label: "Kalender Pendidikan" },
      { kind: "link", to: "/pembelajaran", label: "TP & Lingkup Materi" },
    ],
  },
  {
    id: "guru-nilai",
    label: "Penilaian",
    icon: "score",
    items: [
      { kind: "link", to: "/guru/nilai", label: "Input Nilai" },
      { kind: "link", to: "/guru/nilai-akhir", label: "Nilai Akhir" },
      { kind: "link", to: "/guru/deskripsi-capaian", label: "Deskripsi Capaian" },
      { kind: "link", to: "/guru/status-nilai", label: "Status Nilai" },
    ],
  },
  {
    id: "guru-kegiatan",
    label: "Kegiatan Mengajar",
    icon: "task",
    items: [
      { kind: "link", to: "/guru/absensi", label: "Absensi Siswa" },
      { kind: "link", to: "/guru/jurnal", label: "E-Jurnal Mengajar" },
      { kind: "link", to: "/pegawai/presensi", label: "Presensi Pegawai (GPS)" },
      { kind: "link", to: "/pegawai/izin", label: "Cuti, Izin & SPD" },
      { kind: "link", to: "/pegawai/slip-gaji", label: "Slip Gaji Digital" },
      { kind: "link", to: "/kesiswaan/karakter-bk", label: "Karakter & E-Counseling" },
      { kind: "link", to: "/kesiswaan/pkl", label: "Prakerin / PKL" },
      { kind: "link", to: "/vokasi/inventaris", label: "Bengkel & Inventaris Alat" },
      { kind: "link", to: "/vokasi/bkk", label: "BKK & Tracer Study" },
      { kind: "link", to: "/keuangan/spp", label: "Keuangan & SPP" },
      { kind: "link", to: "/wali/portal", label: "Portal Wali Siswa" },
    ],
  },
  {
    id: "guru-akun",
    label: "Akun",
    icon: "user",
    items: [
      { kind: "link", to: "/pegawai/presensi", label: "Presensi Pegawai (GPS)" },
      { kind: "link", to: "/akun", label: "Profil Saya", end: true },
      { kind: "link", to: "/akun/sandi", label: "Ubah Password" },
    ],
  },
];

const waliGroups: Group[] = [
  { id: "wali-beranda", label: "Beranda", icon: "home", items: [{ kind: "link", to: "/wali/beranda", label: "Dashboard Wali Kelas", end: true }] },
  { id: "wali-kelas", label: "Kelas Perwalian", icon: "class", items: [{ kind: "link", to: "/kalender-pendidikan", label: "Kalender Pendidikan" }, { kind: "link", to: "/wali/penerimaan", label: "Penerimaan Nilai" }, { kind: "link", to: "/wali/monitoring-nilai", label: "Monitoring Nilai" }, { kind: "link", to: "/wali/persiapan-rapor", label: "Persiapan Rapor" }, { kind: "link", to: "/wali/pratinjau-rapor", label: "Pratinjau Rapor" }, { kind: "link", to: "/wali/pemeriksaan-rapor", label: "Pemeriksaan Rapor" }, { kind: "link", to: "/wali/catatan-wali", label: "Catatan Wali Kelas" }, { kind: "link", to: "/wali/deskripsi-capaian", label: "Deskripsi Capaian" }, { kind: "link", to: "/wali/rekap-absensi", label: "Rekap Absensi Mapel" }, { kind: "link", to: "/wali/absensi-harian", label: "Absensi Harian" }, { kind: "link", to: "/wali/nilai-akhir", label: "Nilai Akhir" }, { kind: "link", to: "/wali/rekap-nilai", label: "Rekap Nilai Akhir" }] },
  {
    id: "wali-akun",
    label: "Akun",
    icon: "user",
    items: [
      { kind: "link", to: "/akun", label: "Profil Saya", end: true },
      { kind: "link", to: "/akun/sandi", label: "Ubah Password" },
    ],
  },
];

function isCurrent(pathname: string, item: Leaf): boolean {
  if (item.kind !== "link") return false;
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onNavigate,
  onExpand,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
  onExpand: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { schoolId } = useSchoolScope();
  const { portal, setPortal, choices } = usePortal();
  const showImport = isSchoolAdmin(user, schoolId) || canCoordinate(user, schoolId);
  const showPolicy = canCoordinate(user, schoolId);
  const showUsers = isSchoolAdmin(user, schoolId);
  const academicItems: Leaf[] = academicNavItems(user, schoolId).map((item) => ({ kind: "link", to: item.to, label: item.label }));
  const baseGroups = portal === "guru"
    ? guruGroups
    : portal === "wali"
      ? waliGroups
      : usesWakakurAcademicNav(user, schoolId)
        ? wakakurGroups(showPolicy, academicItems)
        : adminGroups(showImport, showPolicy, showUsers, isWakakur(user, schoolId), isPrincipal(user, schoolId));
  const groups = portal === "admin" && showsAcademicGroup(user, schoolId) ? placeAcademicGroup(baseGroups, academicItems) : baseGroups;
  const activeGroup = groups.find((group) => group.items.some((item) => isCurrent(location.pathname, item)))?.id ?? groups[0]?.id ?? "";
  const [opened, setOpened] = useState(activeGroup);

  useEffect(() => {
    if (activeGroup) setOpened(activeGroup);
  }, [activeGroup]);

  function choosePortal(next: PortalId) {
    setPortal(next);
    onNavigate();
    if (next === "admin") navigate("/");
    if (next === "guru") navigate("/guru/beranda");
    if (next === "wali") navigate("/wali/beranda");
  }

  return (
    <aside
      className={`app-chrome fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-950 text-slate-100 shadow-xl transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 ${collapsed ? "md:w-20" : "md:w-64"}`}
    >
      <div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gold-500/60 bg-navy-900 text-gold-500 text-sm font-bold">SK</span>
        <div className={collapsed ? "md:hidden" : ""}>
          <p className="text-sm font-semibold tracking-wide">SAKTI-Ku</p>
          <p className="text-xs text-slate-400">{PORTAL_LABEL[portal]}</p>
        </div>
      </div>
      {choices.length > 1 ? (
        <label className={`px-4 py-3 text-xs text-slate-400 ${collapsed ? "md:hidden" : ""}`}>
          Portal
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-navy-900 px-3 py-2 text-sm text-white"
            value={portal}
            onChange={(event) => choosePortal(event.target.value as PortalId)}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>{PORTAL_LABEL[choice]}</option>
            ))}
          </select>
        </label>
      ) : null}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => {
          const open = opened === group.id && !(collapsed && !mobileOpen);
          const current = group.items.some((item) => isCurrent(location.pathname, item));
          return (
            <div key={group.id}>
              <button
                type="button"
                title={group.label}
                aria-expanded={open}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-200 ${current ? "bg-white/10 text-white" : "text-slate-100 hover:bg-white/5"}`}
                onClick={() => {
                  if (collapsed) {
                    onExpand();
                    setOpened(group.id);
                    return;
                  }
                  setOpened((current) => (current === group.id ? "" : group.id));
                }}
              >
                <Icon name={group.icon} />
                <span className={`min-w-0 flex-1 truncate ${collapsed ? "md:hidden" : ""}`}>{group.label}</span>
                <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""} ${collapsed ? "md:hidden" : ""}`} viewBox="0 0 20 20" fill="currentColor"><path d="M5.2 7.5 10 12.3l4.8-4.8 1.2 1.2L10 14.7 4 8.7z" /></svg>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} {...(open ? {} : { inert: true })}>
                <div className="min-h-0 overflow-hidden">
                  <div className="space-y-1 pb-2 pl-4">
                    {group.items.map((item) =>
                      item.kind === "soon" ? (
                        <p key={item.label} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-500" title="Modul belum tersedia">
                          <span>{item.label}</span>
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px]">Belum tersedia</span>
                        </p>
                      ) : (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          title={item.label}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            `block min-h-10 truncate rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${isActive ? "bg-gold-500 font-semibold text-navy-950 shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"}`
                          }
                        >
                          {item.label}
                        </NavLink>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
