import type { RoleCode } from "@sims/shared";
import { Link, Navigate, Outlet } from "react-router-dom";
import { isGuru, isOwner, isStaff, isWali, rolesAtSchool } from "../lib/access.ts";
import { SuperAppHome } from "../pages/SuperAppHome.tsx";
import { useAuth } from "../lib/auth.tsx";
import { usePortal } from "../lib/portal.tsx";
import { useSchoolScope } from "../lib/school.tsx";
import { ChangePasswordPage } from "../pages/ChangePasswordPage.tsx";

export function ScreenState({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-slate-600">
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return <ScreenState label="Memuat sesi..." />;
  }
  if (!user) {
    return <Navigate to="/masuk" replace />;
  }
  if (user.mustChangePassword) {
    return <ChangePasswordPage />;
  }
  return <Outlet />;
}

export function ForbiddenPage() {
  const { portal } = usePortal();
  const home = portal === "guru" ? "/guru/beranda" : portal === "wali" ? "/wali/beranda" : "/";
  return (
    <main className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center">
      <h1 className="text-xl font-semibold">Halaman tidak tersedia untuk peran Anda</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Menu administrasi sekolah hanya tampil untuk peran yang berwenang. Hak akses akun Anda tidak berubah.</p>
      <Link to={home} className="mt-5 inline-flex rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white">Kembali ke beranda</Link>
    </main>
  );
}

export function RequireAccess({ allow }: { allow: "staff" | "guru" | "wali" | "plan" }) {
  const { user } = useAuth();
  const { schoolId, loading } = useSchoolScope();
  const { homerooms, loading: portalLoading } = usePortal();
  if (loading || portalLoading) return <p className="text-sm text-slate-500">Memuat akses...</p>;
  const staff = isStaff(user, schoolId);
  const guru = isGuru(user, schoolId);
  const waliRole = isWali(user, schoolId);
  const allowed =
    allow === "staff" ? staff :
    allow === "guru" ? guru :
    allow === "wali" ? waliRole && (homerooms.length > 0 || (!staff && !guru)) :
    staff || guru || waliRole;
  if (!allowed) return <ForbiddenPage />;
  return <Outlet />;
}

export function RequireSchoolRoles({ allow }: { allow: readonly RoleCode[] }) {
  const { user } = useAuth();
  const { schoolId, loading } = useSchoolScope();
  if (loading) return <p className="text-sm text-slate-500">Memuat akses...</p>;
  const allowed = isOwner(user) || rolesAtSchool(user, schoolId).some((role) => allow.includes(role));
  if (!allowed) return <ForbiddenPage />;
  return <Outlet />;
}

export function HomeGate() {
  const { user } = useAuth();
  const { schoolId, loading } = useSchoolScope();
  const { portal, loading: portalLoading } = usePortal();
  if (loading || portalLoading) return <p className="text-sm text-slate-500">Memuat akses...</p>;
  if (!isStaff(user, schoolId)) {
    return <Navigate to={portal === "wali" ? "/wali/beranda" : "/guru/beranda"} replace />;
  }
  return <SuperAppHome />;
}

export function GuestRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return <ScreenState label="Memuat sesi..." />;
  }
  if (user) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
