import { StudentPromotionPage } from "./pages/StudentPromotionPage.tsx";
import { SopFrameworkPage } from "./pages/SopFrameworkPage.tsx";
import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, HomeGate, ProtectedRoute, RequireAccess, RequireSchoolRoles } from "./components/RouteGuards.tsx";
import { AppShell } from "./components/shell/AppShell.tsx";
import { AuthProvider } from "./lib/auth.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";

const ClassesPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.ClassesPage })));
const ConcentrationsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.ConcentrationsPage })));
const FieldsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.FieldsPage })));
const HomeroomsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.HomeroomsPage })));
const ImportPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.ImportPage })));
const ProgramsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.ProgramsPage })));
const StaffLeavePage = lazy(() => import("./pages/StaffLeavePage.tsx").then((m) => ({ default: m.StaffLeavePage })));
const InternshipPage = lazy(() => import("./pages/InternshipPage.tsx").then((m) => ({ default: m.InternshipPage })));
const FinanceParentPortalPage = lazy(() => import("./pages/FinanceParentPortalPage.tsx").then((m) => ({ default: m.FinanceParentPortalPage })));
const PayrollPage = lazy(() => import("./pages/PayrollPage.tsx").then((m) => ({ default: m.PayrollPage })));
const VokasiPage = lazy(() => import("./pages/VokasiPage.tsx").then((m) => ({ default: m.VokasiPage })));
const PublicPortalPage = lazy(() => import("./pages/PublicPortalPage.tsx").then((m) => ({ default: m.PublicPortalPage })));
const CharacterCounselingPage = lazy(() => import("./pages/CharacterCounselingPage.tsx").then((m) => ({ default: m.CharacterCounselingPage })));
const StaffAttendancePage = lazy(() => import("./pages/StaffAttendancePage.tsx").then((m) => ({ default: m.StaffAttendancePage })));
const TeachingJournalPage = lazy(() => import("./pages/TeachingJournalPage.tsx").then((m) => ({ default: m.TeachingJournalPage })));
const SchoolProfilePage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.SchoolProfilePage })));
const SemestersPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.SemestersPage })));
const EducationCalendarPage = lazy(() => import("./pages/EducationCalendarPage.tsx").then((m) => ({ default: m.EducationCalendarPage })));
const StudentsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.StudentsPage })));
const SubjectsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.SubjectsPage })));
const TeachersPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.TeachersPage })));
const TeachingsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.TeachingsPage })));
const YearsPage = lazy(() => import("./pages/AcademicPages.tsx").then((m) => ({ default: m.YearsPage })));

const CurriculaPage = lazy(() => import("./pages/CurriculumPages.tsx").then((m) => ({ default: m.CurriculaPage })));
const LearningPlansPage = lazy(() => import("./pages/CurriculumPages.tsx").then((m) => ({ default: m.LearningPlansPage })));
const AttendanceCompletenessPage = lazy(() => import("./pages/AttendanceCompletenessPage.tsx").then((m) => ({ default: m.AttendanceCompletenessPage })));
const GradePolicyPage = lazy(() => import("./pages/GradePolicyPage.tsx").then((m) => ({ default: m.GradePolicyPage })));
const AccountPasswordPage = lazy(() => import("./pages/AccountPages.tsx").then((m) => ({ default: m.AccountPasswordPage })));
const ProfilePage = lazy(() => import("./pages/AccountPages.tsx").then((m) => ({ default: m.ProfilePage })));
const CompetencyDescriptionPage = lazy(() => import("./pages/CompetencyDescriptionPage.tsx").then((m) => ({ default: m.CompetencyDescriptionPage })));
const HomeroomDescriptionPage = lazy(() => import("./pages/HomeroomDescriptionPage.tsx").then((m) => ({ default: m.HomeroomDescriptionPage })));
const HomeroomNotePage = lazy(() => import("./pages/HomeroomNotePage.tsx").then((m) => ({ default: m.HomeroomNotePage })));
const AttendancePage = lazy(() => import("./pages/AttendancePage.tsx").then((m) => ({ default: m.AttendancePage })));
const AttendanceRecapPage = lazy(() => import("./pages/AttendanceRecapPage.tsx").then((m) => ({ default: m.AttendanceRecapPage })));
const DailyAttendancePage = lazy(() => import("./pages/DailyAttendancePage.tsx").then((m) => ({ default: m.DailyAttendancePage })));
const GradePage = lazy(() => import("./pages/GradePage.tsx").then((m) => ({ default: m.GradePage })));
const GradeFinalPage = lazy(() => import("./pages/GradeFinalPage.tsx").then((m) => ({ default: m.GradeFinalPage })));
const GradeMonitorPage = lazy(() => import("./pages/GradeMonitorPage.tsx").then((m) => ({ default: m.GradeMonitorPage })));
const ReportPrepPage = lazy(() => import("./pages/ReportPrepPage.tsx").then((m) => ({ default: m.ReportPrepPage })));
const ReportPreviewPage = lazy(() => import("./pages/ReportPreviewPage.tsx").then((m) => ({ default: m.ReportPreviewPage })));
const ReportExaminationPage = lazy(() => import("./pages/ReportExaminationPage.tsx").then((m) => ({ default: m.ReportExaminationPage })));
const ReportDecisionPage = lazy(() => import("./pages/ReportDecisionPage.tsx").then((m) => ({ default: m.ReportDecisionPage })));
const GradeRecapPage = lazy(() => import("./pages/GradeRecapPage.tsx").then((m) => ({ default: m.GradeRecapPage })));
const GradeStatusPage = lazy(() => import("./pages/GradeStatusPage.tsx").then((m) => ({ default: m.GradeStatusPage })));
const SchoolUsersPage = lazy(() => import("./pages/SchoolUsersPage.tsx").then((m) => ({ default: m.SchoolUsersPage })));
const MyClassesPage = lazy(() => import("./pages/TeacherPortalPages.tsx").then((m) => ({ default: m.MyClassesPage })));
const TeacherHomePage = lazy(() => import("./pages/TeacherPortalPages.tsx").then((m) => ({ default: m.TeacherHomePage })));
const WaliHomePage = lazy(() => import("./pages/TeacherPortalPages.tsx").then((m) => ({ default: m.WaliHomePage })));

function PageLoader() {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 text-sm font-medium text-navy-950">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy-950 border-t-gold-500" />
        <span>Memuat halaman SAKTI-Ku...</span>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<GuestRoute />}>
              <Route path="/masuk" element={<LoginPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<HomeGate />} />
                <Route element={<RequireAccess allow="staff" />}>
                  <Route path="/profil" element={<SchoolProfilePage />} />
                  <Route path="/tahun-pelajaran" element={<YearsPage />} />
                  <Route path="/semester" element={<SemestersPage />} />
                  <Route path="/bidang" element={<FieldsPage />} />
                  <Route path="/program" element={<ProgramsPage />} />
                  <Route path="/konsentrasi" element={<ConcentrationsPage />} />
                  <Route path="/guru" element={<TeachersPage />} />
                  <Route path="/siswa" element={<StudentsPage />} />
                  <Route path="/kelas" element={<ClassesPage />} />
                  <Route path="/kenaikan-kelas" element={<StudentPromotionPage />} />
                  <Route path="/mapel" element={<SubjectsPage />} />
                  <Route path="/mata-pelajaran" element={<SubjectsPage />} />
                  <Route path="/kurikulum" element={<CurriculaPage />} />
                  <Route path="/pengaturan-nilai" element={<GradePolicyPage />} />
                  <Route path="/pengaturan-absensi" element={<AttendanceCompletenessPage />} />
                  <Route path="/penugasan" element={<TeachingsPage />} />
                  <Route path="/wali-kelas" element={<HomeroomsPage />} />
                  <Route path="/nilai/penerimaan" element={<GradeStatusPage view="staff" />} />
                  <Route path="/validasi-rapor" element={<ReportDecisionPage mode="validation" />} />
                  <Route path="/pengesahan-rapor" element={<ReportDecisionPage mode="endorsement" />} />
                  <Route path="/impor" element={<ImportPage />} />
                  <Route path="/pengguna" element={<SchoolUsersPage />} />
                  <Route path="/keuangan/payroll" element={<PayrollPage mode="admin" />} />
                </Route>
                <Route element={<RequireAccess allow="guru" />}>
                  <Route path="/guru/beranda" element={<TeacherHomePage />} />
                  <Route path="/guru/kelas" element={<MyClassesPage />} />
                  <Route path="/guru/nilai" element={<GradePage />} />
                  <Route path="/guru/nilai-akhir" element={<GradeFinalPage view="guru" />} />
                  <Route path="/guru/deskripsi-capaian" element={<CompetencyDescriptionPage />} />
                  <Route path="/guru/status-nilai" element={<GradeStatusPage view="guru" />} />
                  <Route path="/pegawai/izin" element={<StaffLeavePage />} />
                  <Route path="/pegawai/slip-gaji" element={<PayrollPage mode="employee" />} />
          <Route path="/pegawai/presensi" element={<StaffAttendancePage />} />
          <Route path="/guru/jurnal" element={<TeachingJournalPage />} />
          <Route path="/guru/absensi" element={<AttendancePage />} />
                </Route>
                <Route element={<RequireAccess allow="plan" />}>
                  <Route path="/pembelajaran" element={<LearningPlansPage />} />
                  <Route path="/kalender-pendidikan" element={<EducationCalendarPage />} />
                </Route>
                <Route element={<RequireAccess allow="wali" />}>
                  <Route path="/wali/beranda" element={<WaliHomePage />} />
                  <Route path="/wali/penerimaan" element={<GradeStatusPage view="wali" />} />
                  <Route path="/wali/monitoring-nilai" element={<GradeMonitorPage />} />
                  <Route path="/wali/persiapan-rapor" element={<ReportPrepPage />} />
                  <Route path="/wali/pratinjau-rapor" element={<ReportPreviewPage />} />
                  <Route path="/wali/pemeriksaan-rapor" element={<ReportExaminationPage />} />
                  <Route path="/wali/catatan-wali" element={<HomeroomNotePage />} />
                  <Route path="/wali/deskripsi-capaian" element={<HomeroomDescriptionPage />} />
                  <Route path="/wali/rekap-absensi" element={<AttendanceRecapPage />} />
                  <Route path="/wali/absensi-harian" element={<DailyAttendancePage />} />
                  <Route path="/wali/nilai-akhir" element={<GradeFinalPage view="wali" />} />
                  <Route path="/wali/rekap-nilai" element={<GradeRecapPage />} />
                </Route>
                <Route path="/sop-kerja" element={<SopFrameworkPage />} />
                <Route element={<RequireSchoolRoles allow={["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "WAKAKUR", "TU", "WAKA_KESISWAAN", "WAKA_HUMAS", "KAPROG", "WALI_KELAS"] as const} />}>
                  <Route path="/kesiswaan/pkl" element={<InternshipPage />} />
                </Route>
                <Route element={<RequireSchoolRoles allow={["ADMIN_SEKOLAH", "TU", "KEPALA_SEKOLAH", "WAKAKUR", "GURU_MAPEL", "WALI_KELAS", "KAPROG", "WAKA_SARPRAS", "WAKA_HUMAS", "WAKA_KESISWAAN"] as const} />}>
                  <Route path="/vokasi/inventaris" element={<VokasiPage mode="inventaris" />} />
                  <Route path="/vokasi/bkk" element={<VokasiPage mode="bkk" />} />
                </Route>
                <Route element={<RequireSchoolRoles allow={["ADMIN_SEKOLAH", "TU", "KEPALA_SEKOLAH", "WAKAKUR", "WAKA_HUMAS"] as const} />}>
                  <Route path="/ppdb" element={<PublicPortalPage mode="ppdb" />} />
                </Route>
                <Route element={<RequireSchoolRoles allow={["ADMIN_SEKOLAH", "TU", "KEPALA_SEKOLAH", "WAKAKUR", "GURU_MAPEL", "WALI_KELAS", "WAKA_KESISWAAN"] as const} />}>
                  <Route path="/kesiswaan/whistleblower" element={<PublicPortalPage mode="whistleblower" />} />
                  <Route path="/kesiswaan/karakter-bk" element={<CharacterCounselingPage />} />
                </Route>
                <Route element={<RequireSchoolRoles allow={["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "TU", "BENDAHARA", "KOMITE_SEKOLAH", "WALI_KELAS"] as const} />}>
                  <Route path="/keuangan/spp" element={<FinanceParentPortalPage />} />
                  <Route path="/wali/portal" element={<FinanceParentPortalPage />} />
                </Route>
                <Route path="/akun" element={<ProfilePage />} />
                <Route path="/akun/sandi" element={<AccountPasswordPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
