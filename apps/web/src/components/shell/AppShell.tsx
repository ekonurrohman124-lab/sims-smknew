import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { AcademicPeriodDto } from "@sims/shared";
import { isStaff } from "../../lib/access.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth.tsx";
import { getOfflineQueue } from "../../lib/offline-sync.ts";
import { PortalProvider } from "../../lib/portal.tsx";
import { SchoolProvider, useSchoolScope } from "../../lib/school.tsx";

const SCHOOL_DISPLAY_NAME = "SMK PGRI Pasir Sakti";
const LOGO_SRC = "/logo-smk-pgri-pasir-sakti.jpg";

function ShellFrame() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { schools, schoolId, school, setSchoolId } = useSchoolScope();
  const [periodName, setPeriodName] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(() => getOfflineQueue().length);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (!user?.id) return false;
    const key = `sakti_splash_seen_${user.id}`;
    if (sessionStorage.getItem(key) === "1") return false;
    sessionStorage.setItem(key, "1");
    return true;
  });

  const staff = isStaff(user, schoolId);
  const isHome =
    location.pathname === "/" ||
    location.pathname === "/guru/beranda" ||
    location.pathname === "/wali/beranda";

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => setShowSplash(false), 1250);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  useEffect(() => {
    const targetSchool = schools.find((s) =>
      s.name.toLowerCase().includes("pgri pasir sakti")
    );
    if (targetSchool && targetSchool.id !== schoolId) {
      setSchoolId(targetSchool.id);
    }
  }, [schools, schoolId, setSchoolId]);

  useEffect(() => {
    const onNetChange = () => {
      setIsOnline(navigator.onLine);
      setQueueCount(getOfflineQueue().length);
    };
    window.addEventListener("online", onNetChange);
    window.addEventListener("offline", onNetChange);
    window.addEventListener("sakti-offline-queue-changed", onNetChange);
    return () => {
      window.removeEventListener("online", onNetChange);
      window.removeEventListener("offline", onNetChange);
      window.removeEventListener("sakti-offline-queue-changed", onNetChange);
    };
  }, []);

  useEffect(() => {
    if (!schoolId) {
      setPeriodName("");
      return;
    }
    let active = true;
    api<{ academicPeriods: AcademicPeriodDto[] }>(`/schools/${schoolId}/academic-periods`)
      .then((data) => {
        if (!active) return;
        setPeriodName(data.academicPeriods.find((period) => period.isActive)?.name ?? "");
      })
      .catch(() => {
        if (active) setPeriodName("");
      });
    return () => {
      active = false;
    };
  }, [schoolId]);

  const navItems = [
    {
      to: "/",
      label: "Beranda",
      end: true,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      to: staff ? "/keuangan/payroll" : "/guru/jurnal",
      label: staff ? "Keuangan" : "Jurnal KBM",
      end: false,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      ),
    },
    {
      to: "/vokasi/inventaris",
      label: "Vokasi SMK",
      end: false,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        </svg>
      ),
    },
    {
      to: "/akun",
      label: "Akun",
      end: false,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
          <circle cx="12" cy="8" r="4" />
          <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative min-h-dvh bg-[#F3F5FA] text-slate-900">
      {/* Animasi Pembuka Setelah Login */}
      {showSplash ? (
        <div
          onClick={() => setShowSplash(false)}
          className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-gradient-to-b from-[#07102E] via-[#0D1B4C] to-[#172B70] px-6 text-center text-white transition-opacity duration-300"
        >
          <div className="relative flex h-40 w-40 items-center justify-center overflow-hidden animate-pulse">
            <img
              src={LOGO_SRC}
              alt={SCHOOL_DISPLAY_NAME}
              className="h-full w-full scale-[2.05] object-contain mix-blend-lighten select-none"
            />
          </div>
          <p className="mt-5 text-xs font-bold tracking-[0.2em] text-[#F5C400] uppercase">
            SAKTI-Ku Super-App
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white sm:text-2xl">
            {SCHOOL_DISPLAY_NAME}
          </h2>
          <p className="mt-1.5 text-xs text-slate-300">
            Menyiapkan ruang kerja digital Anda...
          </p>
        </div>
      ) : null}

      {/* Watermark Background Logo (Opacity sangat halus agar tidak bertabrakan dengan teks) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden"
      >
        <img
          src={LOGO_SRC}
          alt=""
          className="h-[26rem] w-[26rem] max-w-[85vw] scale-140 object-cover opacity-[0.045] grayscale select-none sm:h-[32rem] sm:w-[32rem]"
        />
      </div>

      {/* Unified Top Bar (Super-App Style) */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {!isHome ? (
              <Link
                to="/"
                aria-label="Kembali ke Beranda"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-[#0D1B4C] transition hover:bg-slate-200"
              >
                ←
              </Link>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl">
                <img
                  src={LOGO_SRC}
                  alt={SCHOOL_DISPLAY_NAME}
                  className="h-full w-full scale-[2.35] object-contain mix-blend-multiply select-none"
                />
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-[#0D1B4C] sm:text-base">
                {SCHOOL_DISPLAY_NAME}
              </p>
              <p className="truncate text-[11px] font-medium text-slate-500">
                {periodName ? `SAKTI-Ku • Semester ${periodName}` : "SAKTI-Ku Smart Digital School"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div
              title={isOnline ? "Terhubung ke server" : "Mode luring aktif"}
              className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 sm:inline-flex"
            >
              <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span>{isOnline ? "Online" : `Offline (${queueCount})`}</span>
            </div>

            <Link
              to="/akun"
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#F5C400] bg-[#0D1B4C] text-sm font-extrabold text-[#F5C400]"
            >
              {user?.name.slice(0, 1).toUpperCase()}
            </Link>

            <button
              type="button"
              disabled={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                void logout().finally(() => setLoggingOut(false));
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              {loggingOut ? "..." : "Keluar"}
            </button>
          </div>
        </div>
      </header>

      {/* Centered Super-App Canvas */}
      <main className="relative mx-auto w-full max-w-5xl px-4 pt-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-8">
        {school && school.accessStatus !== "AKTIF" ? (
          <p role="status" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
            Status sekolah saat ini: {school.accessStatus}.
          </p>
        ) : null}
        <Outlet />
      </main>

      {/* Floating Pill Bottom Dock (Super-App Style) */}
      <nav
        aria-label="Navigasi Utama"
        className="pointer-events-none fixed right-0 bottom-3 left-0 z-30 px-4 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="pointer-events-auto mx-auto grid max-w-md grid-cols-4 gap-1 rounded-[26px] border border-slate-200/90 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-md">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center rounded-2xl py-2 text-[11px] font-extrabold transition ${
                  isActive
                    ? "bg-[#0D1B4C] text-[#F5C400] shadow-xs"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              {item.icon}
              <span className="mt-1">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function AppShell() {
  return (
    <SchoolProvider>
      <PortalProvider>
        <ShellFrame />
      </PortalProvider>
    </SchoolProvider>
  );
}
