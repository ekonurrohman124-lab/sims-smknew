import { useEffect, useState, type FormEvent, useMemo } from "react";
import type { AcademicOptionsDto, ImportCommitDto, ImportPreviewDto, SchoolDto, TeacherAccountResult, PageResult } from "@sims/shared";
import { DataScreen, type ColumnDef, type FieldDef } from "../components/data/DataScreen.tsx";
import { StudentImportDialog } from "../components/students/StudentImportDialog.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { useSchoolScope } from "../lib/school.tsx";

const GENDER = [
  { value: "LAKI_LAKI", label: "Laki-laki" },
  { value: "PEREMPUAN", label: "Perempuan" },
];

function genderLabel(value: unknown): string {
  if (value === "LAKI_LAKI") return "Laki-laki";
  if (value === "PEREMPUAN") return "Perempuan";
  return "-";
}

function activeLabel(value: unknown): string {
  return value ? "Aktif" : "Tidak aktif";
}

function useOptions(schoolId: string, reloadToken: number) {
  const [options, setOptions] = useState<AcademicOptionsDto | null>(null);
  useEffect(() => {
    if (!schoolId) return;
    let active = true;
    api<{ options: AcademicOptionsDto }>(`/api/v1/schools/${schoolId}/academic-options`)
      .then((data) => {
        if (active) setOptions(data.options);
      })
      .catch(() => {
        if (active) setOptions(null);
      });
    return () => {
      active = false;
    };
  }, [schoolId, reloadToken]);
  return options;
}

function asChoices(items: { id: string; label: string }[] | undefined) {
  return (items ?? []).map((item) => ({ value: item.id, label: item.label }));
}

function MissingSchool() {
  return <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">Pilih sekolah terlebih dahulu.</p>;
}

function schoolStatusLabel(status: string | undefined): string {
  if (status === "NONAKTIF") return "Nonaktif";
  if (status === "DITANGGUHKAN") return "Ditangguhkan";
  return "Aktif";
}

function screen(schoolId: string, path: string) {
  return schoolId ? `/api/v1/schools/${schoolId}/${path}` : "";
}

export function SchoolProfilePage() {
  const { school, schools, schoolId, canManage, isOwner, reloadSchools } = useSchoolScope();
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", npsn: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ id: string; name: string; status: "AKTIF" | "NONAKTIF" | "DITANGGUHKAN" } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    if (!school) return;
    setForm({
      name: school.name,
      npsn: school.npsn,
      address: school.address ?? "",
      city: school.city ?? "",
      province: school.province ?? "",
      postalCode: school.postalCode ?? "",
      phone: school.phone ?? "",
      email: school.email ?? "",
      website: school.website ?? "",
      accreditation: school.accreditation ?? "",
      principalName: school.principalName ?? "",
      stsEnabled: school.stsEnabled,
      sasEnabled: school.sasEnabled,
      requireUh: school.requireUh,
      requireT1: school.requireT1,
      requireT2: school.requireT2,
      requireT3: school.requireT3,
      requireSummative: school.requireSummative,
      requireSts: school.requireSts,
      requireSas: school.requireSas,
    });
  }, [school]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!schoolId) return;
    setSaving(true);
    setError("");
    setMessage("");
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (key === "isActive" || key === "accessStatus") continue;
      payload[key] = typeof value === "boolean" ? value : value === "" ? null : value;
    }
    try {
      await api(`/api/v1/schools/${schoolId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setMessage("Profil sekolah disimpan.");
      reloadSchools();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Profil gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function createSchool(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api<{ school: SchoolDto }>("/api/v1/schools", {
        method: "POST",
        body: JSON.stringify({ name: draft.name, npsn: draft.npsn, isActive: true }),
      });
      setCreating(false);
      setDraft({ name: "", npsn: "" });
      setMessage("Sekolah baru ditambahkan.");
      reloadSchools();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Sekolah gagal ditambahkan.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSchool() {
    if (!schoolId) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/schools/${schoolId}`, { method: "DELETE" });
      setMessage("Sekolah dihapus.");
      reloadSchools();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Sekolah gagal dihapus.");
    } finally {
      setSaving(false);
    }
  }

  function openStatus(target: { id: string; name: string }, status: "AKTIF" | "NONAKTIF" | "DITANGGUHKAN") {
    setStatusError("");
    setStatusReason("");
    setStatusTarget({ ...target, status });
  }

  async function saveStatus() {
    if (!statusTarget) return;
    if (statusTarget.status !== "AKTIF" && statusReason.trim().length < 8) {
      setStatusError("Alasan minimal 8 karakter.");
      return;
    }
    setSaving(true);
    setStatusError("");
    try {
      await api(`/api/v1/schools/${statusTarget.id}/access-status`, {
        method: "PATCH",
        body: JSON.stringify({ status: statusTarget.status, reason: statusReason.trim() || undefined }),
      });
      setStatusTarget(null);
      setMessage(statusTarget.status === "AKTIF" ? "Sekolah diaktifkan kembali." : "Status sekolah diperbarui.");
      reloadSchools();
    } catch (caught) {
      setStatusError(caught instanceof ApiClientError ? caught.message : "Status sekolah gagal diubah.");
    } finally {
      setSaving(false);
    }
  }

  if (!school) return <MissingSchool />;
  const fields = [
    ["name", "Nama sekolah"],
    ["npsn", "NPSN"],
    ["address", "Alamat"],
    ["city", "Kota"],
    ["province", "Provinsi"],
    ["postalCode", "Kode pos"],
    ["phone", "Telepon"],
    ["email", "Email"],
    ["website", "Situs"],
    ["accreditation", "Akreditasi"],
    ["principalName", "Kepala sekolah"],
  ] as const;

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Profil sekolah</h1>
          <p className="text-sm text-slate-500">Data identitas sekolah yang sedang dipilih. Status akses: {schoolStatusLabel(school.accessStatus)}.</p>
        </div>
        {isOwner ? (
          <div className="flex gap-2">
            <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => setCreating(true)}>Tambah sekolah</button>
            <button type="button" className="rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700" onClick={() => void removeSchool()}>Hapus</button>
          </div>
        ) : null}
      </div>
      {message ? <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{message}</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {isOwner ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold">Daftar sekolah</h2>
          <p className="mt-1 text-sm text-slate-500">Hanya pemilik sistem yang mengubah status. Data, akun, dan penugasan tidak dihapus.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {schools.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.npsn} · {schoolStatusLabel(item.accessStatus)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.accessStatus === "AKTIF" ? (
                    <>
                      <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => openStatus(item, "NONAKTIF")}>Nonaktifkan</button>
                      <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => openStatus(item, "DITANGGUHKAN")}>Tangguhkan</button>
                    </>
                  ) : (
                    <button type="button" className="rounded-lg bg-teal-800 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => openStatus(item, "AKTIF")}>Aktifkan kembali</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form onSubmit={(event) => void save(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        {fields.map(([name, label]) => (
          <label key={name} className="text-sm font-medium text-slate-700">
            {label}
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              value={String(form[name] ?? "")}
              disabled={!canManage}
              onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={Boolean(form.stsEnabled)} disabled={!canManage} onChange={(event) => setForm((current) => ({ ...current, stsEnabled: event.target.checked }))} />
          Gunakan STS
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={Boolean(form.sasEnabled)} disabled={!canManage} onChange={(event) => setForm((current) => ({ ...current, sasEnabled: event.target.checked }))} />
          Gunakan SAS
        </label>
        <p className="text-sm text-slate-500 sm:col-span-2">Guru mengisi STS dan SAS hanya jika sekolah mengaktifkannya.</p>
        <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-slate-800">Komponen wajib sebelum nilai dikirim</legend>
          {(
            [
              ["requireUh", "UH wajib"],
              ["requireT1", "Tugas 1 wajib"],
              ["requireT2", "Tugas 2 wajib"],
              ["requireT3", "Tugas 3 wajib"],
              ["requireSummative", "Nilai sumatif wajib"],
              ["requireSts", "STS wajib"],
              ["requireSas", "SAS wajib"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={Boolean(form[name])} disabled={!canManage} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.checked }))} />
              {label}
            </label>
          ))}
          <p className="text-sm text-slate-500 sm:col-span-2">Kosongkan semua jika sekolah belum menetapkan aturan. Ini hanya syarat kelengkapan pengiriman, bukan nilai KKM atau rapor.</p>
        </fieldset>
        {canManage ? (
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Menyimpan..." : "Simpan"}</button>
          </div>
        ) : <p className="text-sm text-slate-500 sm:col-span-2">Anda hanya dapat melihat profil sekolah.</p>}
      </form>
      {statusTarget ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <form className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void saveStatus(); }}>
            <h2 className="text-lg font-semibold">{statusTarget.status === "AKTIF" ? "Aktifkan kembali sekolah?" : statusTarget.status === "DITANGGUHKAN" ? "Tangguhkan sekolah?" : "Nonaktifkan sekolah?"}</h2>
            <p className="text-sm leading-6 text-slate-600">{statusTarget.name} tidak akan dihapus. Nilai, absensi, akun, dan penugasan tetap ada. Sekolah yang tidak aktif tidak dapat dioperasikan sampai diaktifkan kembali.</p>
            {statusError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{statusError}</p> : null}
            {statusTarget.status === "AKTIF" ? null : (
              <label className="block text-sm font-medium text-slate-700">Alasan
                <textarea className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" rows={3} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setStatusTarget(null)}>Batal</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Menyimpan..." : "Konfirmasi"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {creating ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <form onSubmit={(event) => void createSchool(event)} className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 className="text-lg font-semibold">Tambah sekolah</h2>
            <label className="mt-4 block text-sm font-medium">Nama
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="mt-3 block text-sm font-medium">NPSN
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={draft.npsn} onChange={(event) => setDraft((current) => ({ ...current, npsn: event.target.value }))} required />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setCreating(false)}>Batal</button>
              <button type="submit" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white">Simpan</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function Master({
  title,
  description,
  path,
  columns,
  fields,
  creatable = true,
  editable = true,
  write = "coordinate",
  emptyTitle,
  emptyDetail,
}: {
  title: string;
  description: string;
  path: string;
  columns: ColumnDef[];
  fields: (options: AcademicOptionsDto | null) => FieldDef[];
  creatable?: boolean;
  editable?: boolean;
  write?: "coordinate" | "manage";
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  const { schoolId, canManage, canCoordinate } = useSchoolScope();
  const [reloadToken, setReloadToken] = useState(0);
  const options = useOptions(schoolId, reloadToken);
  if (!schoolId) return <MissingSchool />;
  return (
    <DataScreen
      title={title}
      description={description}
      endpoint={screen(schoolId, path)}
      columns={columns}
      fields={fields(options)}
      canWrite={write === "manage" ? canManage : canCoordinate}
      creatable={creatable}
      editable={editable}
      reloadToken={reloadToken}
      onChanged={() => setReloadToken((current) => current + 1)}
      emptyTitle={emptyTitle}
      emptyDetail={emptyDetail}
    />
  );
}

export function YearsPage() {
  return (
    <Master
      title="Tahun pelajaran"
      description="Admin sekolah menambah tahun pelajaran berikutnya dari tombol Tambah. Tombol itu tetap tersedia setelah tahun pertama tersimpan. Wakakur hanya membaca."
      path="academic-years"
      write="manage"
      emptyTitle="Belum ada tahun pelajaran"
      emptyDetail="Admin sekolah menambah tahun pelajaran dengan tombol Tambah. Tahun yang sudah dipakai kelas, kurikulum, nilai, atau rapor hanya dapat diubah status aktifnya."
      columns={[
        { key: "name", label: "Nama" },
        { key: "startDate", label: "Mulai" },
        { key: "endDate", label: "Selesai" },
        { key: "isActive", label: "Status", render: (row) => (row.isActive ? "Aktif" : "Nonaktif") },
      ]}
      fields={() => [
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "startDate", label: "Mulai", type: "date", required: true },
        { name: "endDate", label: "Selesai", type: "date", required: true },
        { name: "isActive", label: "Jadikan tahun aktif", type: "checkbox" },
      ]}
    />
  );
}

type KaldikSemester = {
  semesterKind: "GANJIL" | "GENAP";
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  action: "REUSE" | "CREATE" | "YEAR_MISSING";
  existingId: string | null;
  storedStart: string | null;
  storedEnd: string | null;
};

type KaldikPreview = {
  source: string;
  verification: "BELUM_TERVERIFIKASI";
  warning: string;
  yearStartCandidate: string;
  yearEndCandidate: null;
  overlap: boolean;
  year: { id: string; name: string; startDate: string; endDate: string; isActive: boolean; action: "REUSE"; dateChange: "TIDAK_DIUBAH" } | null;
  semesters: KaldikSemester[];
};

function KaldikPanel({ onApplied }: { onApplied: () => void }) {
  const { schoolId, canManage } = useSchoolScope();
  const [preview, setPreview] = useState<KaldikPreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!schoolId) return;
    let active = true;
    api<{ preview: KaldikPreview }>(`/api/v1/schools/${schoolId}/kaldik-preview`)
      .then((data) => {
        if (active) setPreview(data.preview);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiClientError ? caught.message : "Pratinjau kaldik gagal dimuat.");
      });
    return () => {
      active = false;
    };
  }, [schoolId, tick]);

  if (!schoolId) return null;
  const pending = preview?.semesters.filter((semester) => semester.action === "CREATE") ?? [];

  async function save() {
    if (!preview?.year) return;
    setSaving(true);
    setError("");
    try {
      for (const semester of pending) {
        await api(`/api/v1/schools/${schoolId}/semesters`, {
          method: "POST",
          body: JSON.stringify({
            academicYearId: preview.year.id,
            name: semester.name,
            semesterKind: semester.semesterKind,
            startDate: semester.startDate,
            endDate: semester.endDate,
            isActive: false,
          }),
        });
      }
      setConfirming(false);
      setNotice("Semester yang belum ada tersimpan. Tahun pelajaran tidak diubah dan tidak diaktifkan.");
      setTick((current) => current + 1);
      onApplied();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Semester gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
      <h2 className="text-base font-semibold">Kaldik Lampung 2026/2027</h2>
      {preview ? <p className="mt-1">{preview.source}</p> : null}
      {preview ? <p role="status" className="mt-2">{preview.warning}</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 rounded-xl bg-white px-3 py-2">{notice}</p> : null}
      {preview?.year ? (
        <p className="mt-2">Tahun {preview.year.name} dipakai ulang. Tersimpan {preview.year.startDate} sampai {preview.year.endDate}, status {preview.year.isActive ? "aktif" : "nonaktif"}. Kandidat mulai {preview.yearStartCandidate}. Tanggal selesai tahun belum terverifikasi, jadi tidak diusulkan.</p>
      ) : (
        <p className="mt-2">Tahun pelajaran 2026/2027 belum ada. Buat tahun itu pada menu Tahun Pelajaran sebelum menyimpan semester. Tahun tidak dibuat dari pratinjau ini.</p>
      )}
      {preview ? (
        <ul className="mt-2 list-disc pl-5">
          {preview.semesters.map((semester) => (
            <li key={semester.semesterKind}>
              {semester.name}: {semester.startDate} sampai {semester.endDate}. {semester.action === "REUSE" ? "Sudah ada dan tidak diubah." : semester.action === "CREATE" ? "Belum ada." : "Menunggu tahun pelajaran."}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage && pending.length > 0 && preview && !preview.overlap ? (
        <button type="button" className="mt-3 rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => setConfirming(true)}>
          Tinjau penyimpanan semester
        </button>
      ) : null}
      {confirming ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-800 shadow-xl">
            <h3 className="text-lg font-semibold">Simpan kandidat semester?</h3>
            <p className="mt-2 text-sm leading-6">Tanggal masih belum terverifikasi terhadap lampiran SK. Semester baru disimpan dalam status nonaktif. Tahun pelajaran, siswa, kelas, nilai, presensi, dan rapor tidak diubah.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setConfirming(false)}>Batal</button>
              <button type="button" disabled={saving} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void save()}>{saving ? "Menyimpan..." : "Simpan semester"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function SemestersPage() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="space-y-4">
      <KaldikPanel onApplied={() => setReloadKey((current) => current + 1)} />
      <Master
        key={reloadKey}
        title="Semester"
        description="Semester ganjil atau genap pada tahun pelajaran. Admin sekolah yang mengubah data ini."
        path="semesters"
        write="manage"
      columns={[
        { key: "name", label: "Nama" },
        { key: "semesterKind", label: "Jenis", render: (row) => (row.semesterKind === "GENAP" ? "Genap" : "Ganjil") },
        { key: "academicYearName", label: "Tahun" },
        { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
      ]}
      fields={(options) => [
        { name: "academicYearId", label: "Tahun pelajaran", type: "select", required: true, options: asChoices(options?.years) },
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "semesterKind", label: "Jenis", type: "select", required: true, options: [{ value: "GANJIL", label: "Ganjil" }, { value: "GENAP", label: "Genap" }] },
        { name: "startDate", label: "Mulai", type: "date", required: true },
        { name: "endDate", label: "Selesai", type: "date", required: true },
        { name: "isActive", label: "Jadikan semester aktif", type: "checkbox" },
      ]}
      />
    </div>
  );
}

export function FieldsPage() {
  return (
    <Master
      title="Bidang keahlian"
      description="Bidang keahlian SMK pada sekolah ini. Admin sekolah yang mengubah data ini."
      path="expertise-fields"
      write="manage"
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
      ]}
      fields={() => [
        { name: "code", label: "Kode", type: "text", required: true },
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
      ]}
    />
  );
}

export function ProgramsPage() {
  return (
    <Master
      title="Program keahlian"
      description="Program keahlian berada di bawah bidang. Admin sekolah yang mengubah data ini."
      path="expertise-programs"
      write="manage"
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        { key: "fieldName", label: "Bidang" },
        { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
      ]}
      fields={(options) => [
        { name: "fieldId", label: "Bidang", type: "select", required: true, options: asChoices(options?.fields) },
        { name: "code", label: "Kode", type: "text", required: true },
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
      ]}
    />
  );
}

export function ConcentrationsPage() {
  return (
    <Master
      title="Konsentrasi keahlian"
      description="Konsentrasi berada di bawah program keahlian. Admin sekolah yang mengubah data ini."
      path="expertise-concentrations"
      write="manage"
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        { key: "programName", label: "Program" },
        { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
      ]}
      fields={(options) => [
        { name: "programId", label: "Program", type: "select", required: true, options: asChoices(options?.programs) },
        { name: "code", label: "Kode", type: "text", required: true },
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
      ]}
    />
  );
}

type TeacherRole = "GURU_MAPEL" | "WALI_KELAS";

type TeacherDraft = {
  id: string | null;
  name: string;
  nip: string;
  nuptk: string;
  gender: "" | "LAKI_LAKI" | "PEREMPUAN";
  email: string;
  phone: string;
  roles: TeacherRole[];
  isActive: boolean;
  userId: string | null;
  linking: boolean;
};

const emptyTeacher = (): TeacherDraft => ({
  id: null,
  name: "",
  nip: "",
  nuptk: "",
  gender: "",
  email: "",
  phone: "",
  roles: ["GURU_MAPEL"],
  isActive: true,
  userId: null,
  linking: false,
});

function teacherRoles(value: unknown): TeacherRole[] {
  return Array.isArray(value) ? value.filter((code): code is TeacherRole => code === "GURU_MAPEL" || code === "WALI_KELAS") : [];
}

function linkLabel(value: unknown): string {
  if (value === "TERHUBUNG") return "Terhubung";
  if (value === "BELUM_TERHUBUNG") return "Belum Terhubung";
  return "Belum ada akun";
}

function roleLabel(codes: unknown): string {
  const list = Array.isArray(codes) ? codes : [];
  const names = list.map((code) => (code === "WALI_KELAS" ? "Wali Kelas" : code === "GURU_MAPEL" ? "Guru Mata Pelajaran" : "")).filter(Boolean);
  return names.join(", ") || "Belum ada peran";
}

export function TeachersPage() {
  const { schoolId, canManage, canCoordinate } = useSchoolScope();
  const [reloadToken, setReloadToken] = useState(0);
  const [accountError, setAccountError] = useState("");
  const [notice, setNotice] = useState("");
  const [credential, setCredential] = useState<TeacherAccountResult | null>(null);
  const [draft, setDraft] = useState<TeacherDraft | null>(null);
  const [formError, setFormError] = useState("");
  const [linkOffer, setLinkOffer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<{ id: string; teacherName: string; userName: string } | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  if (!schoolId) return <MissingSchool />;

  async function unlinkAccount() {
    if (!unlinkTarget) return;
    setAccountError("");
    setUnlinking(true);
    try {
      await api<TeacherAccountResult>(`/api/v1/schools/${schoolId}/teachers/${unlinkTarget.id}/unlink-account`, { method: "POST" });
      setUnlinkTarget(null);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setAccountError(caught instanceof ApiClientError ? caught.message : "Tautan akun gagal dilepas.");
    } finally {
      setUnlinking(false);
    }
  }

  async function openAccount(teacherId: string, action: "account" | "reset-password") {
    setAccountError("");
    try {
      const result = await api<TeacherAccountResult>(`/api/v1/schools/${schoolId}/teachers/${teacherId}/${action}`, { method: "POST" });
      setNotice("Kata sandi awal diperbarui. Sampaikan kepada guru.");
      setCredential(result);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setAccountError(caught instanceof ApiClientError ? caught.message : "Akun guru gagal diproses.");
    }
  }

  function openCreate() {
    setFormError("");
    setLinkOffer(false);
    setDraft(emptyTeacher());
  }

  function openEdit(row: Record<string, unknown>) {
    const roles = teacherRoles(row.roleCodes);
    setFormError("");
    setLinkOffer(false);
    setDraft({
      id: String(row.id),
      name: String(row.name ?? ""),
      nip: String(row.nip ?? ""),
      nuptk: String(row.nuptk ?? ""),
      gender: row.gender === "PEREMPUAN" || row.gender === "LAKI_LAKI" ? row.gender : "",
      email: String(row.loginEmail ?? row.email ?? ""),
      phone: String(row.phone ?? ""),
      roles: roles.length > 0 ? roles : ["GURU_MAPEL"],
      isActive: row.isActive !== false,
      userId: row.userId ? String(row.userId) : null,
      linking: false,
    });
  }

  function openLink(row: Record<string, unknown>) {
    const roles = teacherRoles(row.roleCodes);
    setFormError("");
    setLinkOffer(false);
    setDraft({
      id: null,
      name: String(row.name ?? ""),
      nip: "",
      nuptk: "",
      gender: "",
      email: String(row.loginEmail ?? row.email ?? ""),
      phone: "",
      roles,
      isActive: row.isActive !== false,
      userId: row.userId ? String(row.userId) : null,
      linking: true,
    });
  }

  function toggleTeacherRole(code: TeacherRole) {
    setDraft((current) => {
      if (!current) return current;
      const roles = current.roles.includes(code) ? current.roles.filter((item) => item !== code) : [...current.roles, code];
      return { ...current, roles };
    });
  }

  async function saveTeacher(linkExisting = false) {
    if (!draft || !schoolId) return;
    if (!draft.name.trim() || draft.name.trim().length < 3) {
      setFormError("Nama guru minimal 3 karakter.");
      return;
    }
    if (!draft.gender) {
      setFormError("Jenis kelamin wajib dipilih.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      setFormError("Email/login wajib diisi dan harus valid.");
      return;
    }
    if (draft.linking && !draft.userId) {
      setFormError("Akun yang akan dihubungkan tidak ditemukan.");
      return;
    }
    if (draft.roles.length === 0) {
      setFormError("Pilih minimal satu peran. Guru Mata Pelajaran dapat digabung dengan Wali Kelas.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const body = {
        name: draft.name.trim(),
        nip: draft.nip.trim(),
        nuptk: draft.nuptk.trim(),
        gender: draft.gender,
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        roles: draft.roles,
        isActive: draft.isActive,
        linkExisting,
      };
      const result = draft.linking
        ? await api<TeacherAccountResult>(`/api/v1/schools/${schoolId}/teachers/link-profile`, {
            method: "POST",
            body: JSON.stringify({
              userId: draft.userId,
              name: draft.name.trim(),
              gender: draft.gender,
              nip: draft.nip.trim(),
              nuptk: draft.nuptk.trim(),
              phone: draft.phone.trim(),
            }),
          })
        : draft.id
          ? await api<TeacherAccountResult>(`/api/v1/schools/${schoolId}/teachers/${draft.id}/profile`, { method: "PATCH", body: JSON.stringify(body) })
          : await api<TeacherAccountResult>(`/api/v1/schools/${schoolId}/teachers/with-account`, { method: "POST", body: JSON.stringify(body) });
      setDraft(null);
      setLinkOffer(false);
      setNotice(draft.linking ? "Profil guru terhubung ke akun yang sudah ada. Kata sandi dan peran lain tidak diubah." : result.created ? "Guru dan akun masuk disimpan." : draft.id ? "Data guru diperbarui." : "Akun yang sudah ada dihubungkan ke data guru. Kata sandi tidak diubah.");
      if (result.temporaryPassword) setCredential(result);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "ACCOUNT_EXISTS") {
        setLinkOffer(true);
        setFormError(caught.message);
      } else {
        setLinkOffer(false);
        setFormError(caught instanceof ApiClientError ? caught.message : "Guru gagal disimpan.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {accountError ? <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{accountError}</p> : null}
      {notice ? <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {canManage ? (
        <div className="mb-3 flex justify-end">
          <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={openCreate}>Tambah guru</button>
        </div>
      ) : null}
      <DataScreen
        title="Guru"
        description="Akun Guru Mapel dan Wali Kelas yang sudah ada tampil di sini. Profil yang belum tertaut dihubungkan tanpa membuat akun baru."
        endpoint={screen(schoolId, "teachers")}
        initialPageSize={25}
        columns={[
          { key: "name", label: "Nama" },
          { key: "nip", label: "NIP" },
          { key: "loginEmail", label: "Email masuk", render: (row) => (row.loginEmail ? String(row.loginEmail) : "Belum ada akun") },
          { key: "roleCodes", label: "Peran", render: (row) => roleLabel(row.roleCodes) },
          { key: "linkStatus", label: "Tautan", render: (row) => linkLabel(row.linkStatus) },
          { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
        ]}
        fields={[]}
        canWrite={canManage}
        creatable={false}
        editable={false}
        reloadToken={reloadToken}
        onChanged={() => setReloadToken((current) => current + 1)}
        extraActions={(row) => row.linkStatus === "BELUM_TERHUBUNG" ? (
          canManage ? <button type="button" className="rounded-lg border border-teal-700 px-2 py-1 font-semibold text-teal-800" onClick={() => openLink(row)}>Hubungkan Profil</button> : null
        ) : (
          <>
            <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={() => openEdit(row)}>Ubah</button>
            {row.userId ? (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2 py-1"
                  onClick={() => setUnlinkTarget({ id: String(row.id), teacherName: String(row.name ?? "guru"), userName: String(row.userName ?? "akun ini") })}
                >
                  Lepas tautan
                </button>
                <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={() => void openAccount(String(row.id), "reset-password")}>Reset Password</button>
              </>
            ) : null}
          </>
        )}
      />
      {draft ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <form className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void saveTeacher(false); }}>
            <div>
              <h2 className="text-lg font-semibold">{draft.linking ? "Hubungkan profil" : draft.id ? "Ubah guru" : "Tambah guru"}</h2>
              <p className="mt-1 text-sm text-slate-500">{draft.linking ? "Nama dan email diambil dari akun yang sudah ada. Lengkapi data yang belum tersedia. Peran, kata sandi, dan hak akses tidak diubah." : draft.id ? "Akun yang sudah terhubung tetap dipakai. Peran dapat disesuaikan." : "Satu simpanan membuat data guru dan akun masuk."}</p>
            </div>
            {formError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p> : null}
            <label className="block text-sm font-medium text-slate-700">Nama guru
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">NIP
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" value={draft.nip} onChange={(event) => setDraft({ ...draft, nip: event.target.value })} />
              </label>
              <label className="block text-sm font-medium text-slate-700">NUPTK
                <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" value={draft.nuptk} onChange={(event) => setDraft({ ...draft, nuptk: event.target.value })} />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">Jenis kelamin
              <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value as TeacherDraft["gender"] })}>
                <option value="">Pilih</option>
                {GENDER.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">Email/login
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" type="email" value={draft.email} disabled={Boolean(draft.userId) || draft.linking} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </label>
            <label className="block text-sm font-medium text-slate-700">Telepon
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
            </label>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-slate-700">Peran</legend>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.roles.includes("GURU_MAPEL")} disabled={draft.linking} onChange={() => toggleTeacherRole("GURU_MAPEL")} />Guru Mata Pelajaran</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.roles.includes("WALI_KELAS")} disabled={draft.linking} onChange={() => toggleTeacherRole("WALI_KELAS")} />Wali Kelas</label>
            </fieldset>
            {draft.linking ? null : (
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
                Akun aktif
              </label>
            )}
            {draft.linking ? <p className="text-xs text-slate-500">Peran lain pada akun ini tetap berlaku. Tidak ada akun login baru.</p> : null}
            {draft.userId && !draft.linking ? <p className="text-xs text-slate-500">Akun masuk tetap terhubung. Email login tidak diganti dari formulir ini.</p> : null}
            {!draft.id && !draft.userId && !draft.linking ? <p className="text-xs text-slate-500">Kata sandi awal dibuat otomatis dan wajib diganti saat masuk pertama.</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => { setDraft(null); setLinkOffer(false); }}>Batal</button>
              {linkOffer ? <button type="button" className="rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800" disabled={saving} onClick={() => void saveTeacher(true)}>Hubungkan akun yang sudah ada</button> : null}
              <button type="submit" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {unlinkTarget ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Lepas tautan akun?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Akun {unlinkTarget.userName} akan dilepas dari guru {unlinkTarget.teacherName}. Data guru, penugasan, dan riwayat tetap ada. Akun pengguna tidak dihapus dan kata sandinya tidak berubah.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setUnlinkTarget(null)}>Batal</button>
              <button type="button" disabled={unlinking} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void unlinkAccount()}>
                {unlinking ? "Melepas..." : "Lepas tautan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {credential?.temporaryPassword ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Kata sandi awal</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Kata sandi ini hanya ditampilkan sekali. Sampaikan kepada guru. Guru wajib menggantinya saat masuk pertama.</p>
            <p className="mt-3 text-sm text-slate-500">Email masuk</p>
            <p className="font-medium">{credential.item.loginEmail ?? credential.item.email}</p>
            <p className="mt-3 text-sm text-slate-500">Kata sandi</p>
            <input readOnly className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm" value={credential.temporaryPassword} />
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => setCredential(null)}>Tutup</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function StudentsPage() {
  const { schoolId, school, canManage } = useSchoolScope();
  const [reloadToken, setReloadToken] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [concentrationId, setConcentrationId] = useState("");
  const [classId, setClassId] = useState("");
  const options = useOptions(schoolId, reloadToken);
  const rosterClasses = useMemo(
    () => (options?.classes ?? []).filter((item) => item.academicYearActive),
    [options?.classes],
  );
  const visibleClasses = useMemo(
    () => rosterClasses.filter((item) => !concentrationId || item.concentrationId === concentrationId),
    [rosterClasses, concentrationId],
  );
  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (concentrationId) params.concentrationId = concentrationId;
    if (classId) params.classId = classId;
    return params;
  }, [concentrationId, classId]);
  if (!schoolId) return <MissingSchool />;
  const operational = school?.accessStatus !== "NONAKTIF" && school?.accessStatus !== "DITANGGUHKAN";
  const selectClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <>
      {notice ? <p role="status" className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{notice}</p> : null}
      <DataScreen
        title="Siswa"
        description="NISN unik secara nasional. NIS boleh dikosongkan dan, jika diisi, unik di dalam sekolah."
        endpoint={screen(schoolId, "students")}
        layout="grid"
        stackOnMobile
        searchPlaceholder="Cari nama, NISN, atau NIS"
        queryParams={queryParams}
        toolbar={(
          <>
            <label className="block text-sm text-slate-600">
              Jurusan
              <select
                className={selectClass}
                aria-label="Jurusan"
                value={concentrationId}
                onChange={(event) => {
                  const next = event.target.value;
                  setConcentrationId(next);
                  setClassId((current) => {
                    if (!next || !current) return current;
                    const selected = rosterClasses.find((item) => item.id === current);
                    return selected?.concentrationId === next ? current : "";
                  });
                }}
              >
                <option value="">Semua</option>
                {(options?.concentrations ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-sm text-slate-600">
              Kelas
              <select className={selectClass} aria-label="Kelas" value={classId} onChange={(event) => setClassId(event.target.value)}>
                <option value="">Semua</option>
                {visibleClasses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </>
        )}
        columns={[
          { key: "name", label: "Nama", headerClassName: "min-w-48", cellClassName: "min-w-48 whitespace-normal break-words" },
          { key: "nisn", label: "NISN", headerClassName: "min-w-32", cellClassName: "min-w-32 whitespace-nowrap font-mono" },
          {
            key: "nis",
            label: "NIS",
            headerClassName: "min-w-32",
            cellClassName: "min-w-32 whitespace-nowrap font-mono",
            render: (row) => (typeof row.nis === "string" && row.nis.trim() ? row.nis : "Belum diisi"),
          },
          { key: "className", label: "Kelas", headerClassName: "min-w-28", cellClassName: "min-w-28" },
          { key: "gender", label: "Jenis kelamin", headerClassName: "min-w-32", cellClassName: "min-w-32", render: (row) => genderLabel(row.gender) },
        ]}
        fields={[
          { name: "name", label: "Nama", type: "text", required: true },
          { name: "nisn", label: "NISN", type: "text", required: true },
          { name: "nis", label: "NIS", type: "text", placeholder: "Opsional", hint: "Kosongkan jika belum ada. NISN tidak disalin menjadi NIS." },
          { name: "gender", label: "Jenis kelamin", type: "select", required: true, options: GENDER },
          { name: "birthPlace", label: "Tempat lahir", type: "text" },
          { name: "birthDate", label: "Tanggal lahir", type: "date" },
          { name: "email", label: "Email", type: "email" },
          { name: "phone", label: "Telepon", type: "text" },
          { name: "classId", label: "Kelas", type: "select", options: asChoices(options?.classes) },
          { name: "concentrationId", label: "Konsentrasi", type: "select", options: asChoices(options?.concentrations) },
          { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
        ]}
        canWrite={canManage}
        reloadToken={reloadToken}
        onChanged={() => setReloadToken((current) => current + 1)}
        actions={canManage ? (
          <button type="button" className="rounded-xl border border-teal-800 px-4 py-2 text-sm font-semibold text-teal-800" onClick={() => setImportOpen(true)}>
            Import Excel
          </button>
        ) : null}
      />
      {importOpen ? (
        <StudentImportDialog
          schoolId={schoolId}
          years={options?.years ?? []}
          operational={operational}
          onClose={() => setImportOpen(false)}
          onImported={(message) => {
            setNotice(message);
            setReloadToken((current) => current + 1);
          }}
        />
      ) : null}
    </>
  );
}

export function ClassesPage() {
  return (
    <Master
      title="Kelas"
      description="Kelas terikat pada tahun pelajaran. Admin sekolah yang mengubah data ini."
      path="classes"
      write="manage"
      columns={[
        { key: "name", label: "Nama" },
        { key: "gradeLevel", label: "Tingkat" },
        { key: "academicYearName", label: "Tahun" },
        { key: "concentrationName", label: "Konsentrasi" },
        { key: "capacity", label: "Daya tampung" },
      ]}
      fields={(options) => [
        { name: "name", label: "Nama kelas", type: "text", required: true },
        { name: "gradeLevel", label: "Tingkat", type: "number", required: true, defaultValue: "10" },
        { name: "academicYearId", label: "Tahun pelajaran", type: "select", required: true, options: asChoices(options?.years) },
        { name: "concentrationId", label: "Konsentrasi", type: "select", options: asChoices(options?.concentrations) },
        { name: "capacity", label: "Daya tampung", type: "number", defaultValue: "36" },
        { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
      ]}
    />
  );
}

export function SubjectsPage() {
  return (
    <Master
      title="Mata pelajaran"
      description="Mata pelajaran umum dan kejuruan."
      path="subjects"
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        { key: "category", label: "Kategori", render: (row) => (row.category === "KEJURUAN" ? "Kejuruan" : "Umum") },
        { key: "isActive", label: "Status", render: (row) => activeLabel(row.isActive) },
      ]}
      fields={() => [
        { name: "code", label: "Kode", type: "text", required: true },
        { name: "name", label: "Nama", type: "text", required: true },
        { name: "category", label: "Kategori", type: "select", required: true, options: [{ value: "UMUM", label: "Umum" }, { value: "KEJURUAN", label: "Kejuruan" }] },
        { name: "isActive", label: "Aktif", type: "checkbox", defaultValue: true },
      ]}
    />
  );
}

type TeachingRowDto = {
  id: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  academicPeriodId: string;
  periodName: string;
};

type GroupedTeachingDto = {
  key: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  academicPeriodId: string;
  periodName: string;
  classes: { assignmentId: string; classId: string; className: string }[];
};

export function TeachingsPage() {
  const { schoolId, canCoordinate } = useSchoolScope();
  const [reloadToken, setReloadToken] = useState(0);
  const options = useOptions(schoolId, reloadToken);
  const [rows, setRows] = useState<TeachingRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ label: string; ids: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const all: TeachingRowDto[] = [];
      let page = 1;
      while (true) {
        const res = await api<PageResult<TeachingRowDto>>(`/api/v1/schools/${schoolId}/teaching-assignments?page=${page}&pageSize=50`);
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
        page += 1;
      }
      if (active) setRows(all);
    })()
      .catch((caught) => {
        if (active) setError(caught instanceof ApiClientError ? caught.message : "Data penugasan gagal dimuat.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [schoolId, reloadToken]);

  const grouped = useMemo<GroupedTeachingDto[]>(() => {
    const map = new Map<string, GroupedTeachingDto>();
    const keyword = search.trim().toLowerCase();
    for (const row of rows) {
      const key = `${row.teacherId}::${row.subjectId}::${row.academicPeriodId}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          teacherId: row.teacherId,
          teacherName: row.teacherName,
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          academicPeriodId: row.academicPeriodId,
          periodName: row.periodName,
          classes: [],
        };
        map.set(key, group);
      }
      group.classes.push({ assignmentId: row.id, classId: row.classId, className: row.className });
    }
    const list = [...map.values()].map((group) => ({
      ...group,
      classes: [...group.classes].sort((a, b) => a.className.localeCompare(b.className, "id")),
    }));
    if (!keyword) return list;
    return list.filter(
      (item) =>
        item.teacherName.toLowerCase().includes(keyword) ||
        item.subjectName.toLowerCase().includes(keyword) ||
        item.periodName.toLowerCase().includes(keyword) ||
        item.classes.some((cls) => cls.className.toLowerCase().includes(keyword)),
    );
  }, [rows, search]);

  if (!schoolId) return <MissingSchool />;

  function openModal(preset?: GroupedTeachingDto) {
    setError("");
    setNotice("");
    setTeacherId(preset?.teacherId ?? "");
    setSubjectId(preset?.subjectId ?? "");
    setPeriodId(preset?.academicPeriodId ?? options?.periods?.[0]?.id ?? "");
    setSelectedClassIds(preset ? preset.classes.map((c) => c.classId) : []);
    setModalOpen(true);
  }

  function toggleClass(id: string) {
    setSelectedClassIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submitBulk(event: FormEvent) {
    event.preventDefault();
    if (!teacherId || !subjectId || !periodId || selectedClassIds.length === 0) {
      setError("Pilih guru, mata pelajaran, semester, dan minimal satu kelas.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const classIds = [...new Set(selectedClassIds)];
    let created = 0;
    let duplicate = 0;
    let failed = 0;
    const failureNotes: string[] = [];
    for (const classId of classIds) {
      const classLabel = options?.classes?.find((item) => item.id === classId)?.label ?? "Kelas";
      try {
        await api(`/api/v1/schools/${schoolId}/teaching-assignments`, {
          method: "POST",
          body: JSON.stringify({ teacherId, subjectId, classId, academicPeriodId: periodId }),
        });
        created += 1;
      } catch (caught) {
        if (caught instanceof ApiClientError && (caught.status === 409 || caught.code === "DUPLICATE")) {
          duplicate += 1;
          continue;
        }
        failed += 1;
        const reason = caught instanceof ApiClientError ? caught.message : "Tidak dapat terhubung ke server.";
        failureNotes.push(`${classLabel}: ${reason}`);
      }
    }
    const summary = `Penugasan: berhasil ${created}, duplikat ${duplicate}, gagal ${failed}.`;
    setSaving(false);
    if (failed > 0) {
      setError(`${summary} ${failureNotes.slice(0, 3).join("; ")}`);
    } else {
      setNotice(summary);
      setModalOpen(false);
    }
    if (created > 0) setReloadToken((prev) => prev + 1);
  }

  async function executeDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError("");
    try {
      for (const id of confirmDelete.ids) {
        await api(`/api/v1/schools/${schoolId}/teaching-assignments/${id}`, { method: "DELETE" });
      }
      setNotice(`Penugasan "${confirmDelete.label}" dihapus.`);
      setConfirmDelete(null);
      setReloadToken((prev) => prev + 1);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Penugasan gagal dihapus.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy-950">Penugasan mengajar</h1>
          <p className="mt-1 text-sm text-slate-500">Kelola penugasan guru &amp; mata pelajaran ke satu atau banyak kelas sekaligus dalam satu tampilan ringkas.</p>
        </div>
        {canCoordinate ? (
          <button
            type="button"
            onClick={() => openModal()}
            className="rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-900"
          >
            + Tambah Penugasan
          </button>
        ) : null}
      </div>

      {notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">{notice}</p> : null}
      {error && !modalOpen ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama guru, mata pelajaran, atau kelas..."
          className="w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-navy-950 focus:outline-none"
        />
        <span className="text-xs font-medium text-slate-500">{grouped.length} kelompok penugasan ({rows.length} rombel)</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3.5">Guru</th>
                <th className="px-4 py-3.5">Mapel</th>
                <th className="px-4 py-3.5">Kelas Ampuan</th>
                <th className="px-4 py-3.5">Semester</th>
                {canCoordinate ? <th className="px-4 py-3.5 text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={canCoordinate ? 5 : 4} className="px-4 py-8 text-center text-slate-500">Memuat data penugasan...</td>
                </tr>
              ) : grouped.length === 0 ? (
                <tr>
                  <td colSpan={canCoordinate ? 5 : 4} className="px-4 py-8 text-center text-slate-500">Belum ada penugasan mengajar.</td>
                </tr>
              ) : (
                grouped.map((group) => (
                  <tr key={group.key} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5 font-semibold text-slate-900">{group.teacherName}</td>
                    <td className="px-4 py-3.5 font-medium text-slate-700">{group.subjectName}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {group.classes.map((cls) => (
                          <span
                            key={cls.assignmentId}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold tracking-wide text-indigo-900 shadow-2xs"
                          >
                            <span>{cls.className}</span>
                            {canCoordinate ? (
                              <button
                                type="button"
                                title={`Lepas kelas ${cls.className}`}
                                onClick={() =>
                                  setConfirmDelete({
                                    label: `${group.teacherName} · ${group.subjectName} (${cls.className})`,
                                    ids: [cls.assignmentId],
                                  })
                                }
                                className="ml-0.5 rounded px-1 text-indigo-500 hover:bg-indigo-200/70 hover:text-red-700"
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{group.periodName}</td>
                    {canCoordinate ? (
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openModal(group)}
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            + Kelas
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                label: `${group.teacherName} · ${group.subjectName} (Semua ${group.classes.length} kelas)`,
                                ids: group.classes.map((c) => c.assignmentId),
                              })
                            }
                            className="rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-navy-950">Penugasan Guru Multi-Kelas</h2>
                <p className="mt-0.5 text-xs text-slate-500">Pilih guru, mata pelajaran, dan centang satu atau banyak kelas sekaligus.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
            </div>
            <form onSubmit={submitBulk} className="mt-4 space-y-4">
              {error ? <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">{error}</p> : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-700">
                  Guru Pengampu
                  <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required>
                    <option value="">Pilih guru...</option>
                    {(options?.teachers ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Mata Pelajaran
                  <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                    <option value="">Pilih mapel...</option>
                    {(options?.subjects ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Semester
                  <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal" value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
                    <option value="">Pilih semester...</option>
                    {(options?.periods ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Pilih Kelas Target ({selectedClassIds.length} dipilih):</span>
                  <button
                    type="button"
                    onClick={() => setSelectedClassIds(selectedClassIds.length === (options?.classes ?? []).length ? [] : (options?.classes ?? []).map((c) => c.id))}
                    className="text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    {selectedClassIds.length === (options?.classes ?? []).length ? "Batal Pilih Semua" : "Pilih Semua Kelas"}
                  </button>
                </div>
                <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-3">
                  {(options?.classes ?? []).map((cls) => {
                    const checked = selectedClassIds.includes(cls.id);
                    return (
                      <label key={cls.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${checked ? "border-indigo-600 bg-indigo-50 text-indigo-950 shadow-2xs" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleClass(cls.id)} className="rounded border-slate-300 text-indigo-700" />
                        <span>{cls.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">Batal</button>
                <button type="submit" disabled={saving || selectedClassIds.length === 0} className="rounded-xl bg-teal-800 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-50">
                  {saving ? "Menyimpan..." : `Simpan Penugasan (${selectedClassIds.length} Kelas)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-navy-950">Hapus penugasan?</h2>
            <p className="mt-2 text-sm text-slate-600">Penugasan <strong>{confirmDelete.label}</strong> akan dihapus jika belum memiliki nilai atau jurnal.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">Batal</button>
              <button type="button" disabled={deleting} onClick={() => void executeDelete()} className="rounded-xl bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {deleting ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function HomeroomsPage() {
  return (
    <Master
      title="Wali kelas"
      description="Satu kelas satu wali pada semester yang sama. Guru tersebut tetap dapat ditugaskan sebagai guru mapel."
      path="homeroom-assignments"
      editable={false}
      columns={[
        { key: "teacherName", label: "Guru" },
        { key: "className", label: "Kelas" },
        { key: "periodName", label: "Semester" },
      ]}
      fields={(options) => [
        { name: "teacherId", label: "Guru", type: "select", required: true, options: asChoices(options?.teachers) },
        { name: "classId", label: "Kelas", type: "select", required: true, options: asChoices(options?.classes) },
        { name: "academicPeriodId", label: "Semester", type: "select", required: true, options: asChoices(options?.periods) },
      ]}
    />
  );
}

type ImportKind = "students" | "teachers" | "learning-objectives" | "material-scopes";

const TEMPLATE_NAME: Record<ImportKind, string> = {
  students: "templat-siswa.csv",
  teachers: "templat-guru.csv",
  "learning-objectives": "templat-tujuan-pembelajaran.csv",
  "material-scopes": "templat-lingkup-materi.csv",
};

export function ImportPage() {
  const { user } = useAuth();
  const { schoolId, canManage, canCoordinate } = useSchoolScope();
  const canPlan =
    canCoordinate ||
    (user?.assignments.some(
      (assignment) =>
        assignment.schoolId === schoolId &&
        (assignment.roleCode === "GURU_MAPEL" || assignment.roleCode === "WALI_KELAS"),
    ) ??
      false);
  const [kind, setKind] = useState<ImportKind>("students");
  useEffect(() => {
    if (!canManage && (kind === "students" || kind === "teachers")) setKind("learning-objectives");
  }, [canManage, kind]);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<ImportCommitDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!schoolId) return <MissingSchool />;

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    try {
      setPreview(await api<ImportPreviewDto>(`/api/v1/schools/${schoolId}/imports/${kind}/preview`, { method: "POST", body }));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof ApiClientError ? caught.message : "Berkas gagal diperiksa.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<ImportCommitDto>(`/api/v1/schools/${schoolId}/imports/${kind}/commit`, {
        method: "POST",
        body: JSON.stringify({ rows: preview.rows.map((row) => row.data) }),
      });
      setResult(response);
      setPreview({
        rows: response.rows,
        validCount: response.rows.filter((row) => row.valid).length,
        invalidCount: response.rows.filter((row) => !row.valid).length,
      });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Impor gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Impor data</h1>
        <p className="mt-1 text-sm text-slate-500">Unggah CSV atau XLSX, periksa hasilnya, lalu simpan baris yang valid.</p>
      </div>
      {!canManage && !canPlan ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Anda tidak dapat mengimpor data master.</p> : null}
      {canPlan && !canManage ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Impor guru dan siswa hanya untuk admin. TP dan LM mengikuti penugasan Anda.</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={kind} onChange={(event) => { setKind(event.target.value as ImportKind); setPreview(null); setResult(null); }}>
          {canManage ? <option value="students">Siswa</option> : null}
          {canManage ? <option value="teachers">Guru</option> : null}
          {canPlan ? <option value="learning-objectives">Tujuan pembelajaran</option> : null}
          {canPlan ? <option value="material-scopes">Lingkup materi</option> : null}
        </select>
        <button
          type="button"
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
          onClick={() => {
            const token = sessionStorage.getItem("sims.accessToken");
            void fetch(`/api/v1/schools/${schoolId}/imports/${kind}/template`, {
              headers: token ? { authorization: `Bearer ${token}` } : {},
              credentials: "include",
            }).then(async (response) => {
              if (!response.ok) {
                setError("Templat gagal diunduh.");
                return;
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = TEMPLATE_NAME[kind];
              link.click();
              URL.revokeObjectURL(url);
            });
          }}
        >
          Unduh templat
        </button>
        <label className="rounded-xl bg-teal-800 px-4 py-2 text-center text-sm font-semibold text-white">
          Pilih berkas
          <input className="hidden" type="file" accept=".csv,.xlsx,text/csv" disabled={busy || (kind === "students" || kind === "teachers" ? !canManage : !canPlan)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        </label>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {result ? <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{result.created} data masuk, {result.skipped} baris dilewati.</p> : null}
      {preview ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{preview.validCount} baris valid, {preview.invalidCount} baris bermasalah.</p>
          <div className="space-y-2">
            {preview.rows.map((row) => (
              <article key={row.rowNumber} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-medium">Baris {row.rowNumber}: {row.data.nama || row.data.kode || row.data.deskripsi || "-"}</p>
                <p className={row.valid ? "text-teal-800" : "text-red-700"}>{row.valid ? "Siap disimpan" : row.errors.join(" ")}</p>
              </article>
            ))}
          </div>
          {(kind === "students" || kind === "teachers" ? canManage : canPlan) ? <button type="button" disabled={busy || preview.validCount === 0} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void commit()}>Simpan yang valid</button> : null}
        </div>
      ) : null}
    </section>
  );
}
