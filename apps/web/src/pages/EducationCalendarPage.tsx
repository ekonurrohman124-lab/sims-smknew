import { useEffect, useState, type FormEvent } from "react";
import { SemestersPage } from "./AcademicPages.tsx";
import { ApiClientError, api } from "../lib/api.ts";
import { useSchoolScope } from "../lib/school.tsx";

type CalendarItem = {
  id: string;
  dateText: string;
  eventDate: string | null;
  endDate: string | null;
  title: string;
  category: "KEGIATAN" | "LIBUR" | "ASESMEN" | "RAPOR" | "SEMESTER";
  semesterKind: "GANJIL" | "GENAP" | null;
  verification: "TERVERIFIKASI" | "PERLU_VERIFIKASI";
  warning: string | null;
  source?: string;
};

type CalendarDocument = {
  id: string;
  academicYearId: string;
  academicYearName: string;
  originalName: string;
  decisionNumber: string | null;
  extractedYear: string | null;
  npsnStatus: string;
  yearStatus: string;
  status: "DRAFT" | "PUBLISHED";
  warning: string | null;
  items: CalendarItem[];
  notes: Array<{ id: string; authorName: string; body: string; createdAt: string }>;
};

type Integration = { semesterKind: "GANJIL" | "GENAP"; action: "CREATE" | "REUSE" | "PERLU_KEPUTUSAN"; reason?: string; startDate?: string; endDate?: string };

type Detail = { document: CalendarDocument; integration: Integration[] | null; duplicate?: boolean };

const TABS = ["Kalender Pendidikan", "Upload & Integrasi", "Pengaturan Semester"] as const;
const CATEGORIES = ["KEGIATAN", "LIBUR", "ASESMEN", "RAPOR", "SEMESTER"] as const;

function labelCategory(value: string): string {
  if (value === "LIBUR") return "Hari libur";
  if (value === "ASESMEN") return "Asesmen";
  if (value === "RAPOR") return "Pembagian rapor";
  if (value === "SEMESTER") return "Semester";
  return "Kegiatan sekolah";
}

const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const WEEKDAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const WEEKDAY_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

type ShownItem = CalendarItem & { documentId: string; documentStatus: "DRAFT" | "PUBLISHED"; documentName?: string; decision?: string | null };

function shortTitle(title: string): string {
  const named = title.includes(":") ? title.slice(title.lastIndexOf(":") + 1).trim() : title.trim();
  return named.length > 18 ? `${named.slice(0, 17).trimEnd()}…` : named;
}

function categoryClass(value: string): string {
  if (value === "LIBUR") return "bg-rose-100 text-rose-900";
  if (value === "ASESMEN") return "bg-amber-100 text-amber-950";
  if (value === "RAPOR") return "bg-indigo-100 text-indigo-950";
  if (value === "SEMESTER") return "bg-sky-100 text-sky-950";
  return "bg-teal-100 text-teal-950";
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthCells(year: number, month: number): Array<string | null> {
  const sundayIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = (sundayIndex + 6) % 7;
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= total; day += 1) cells.push(isoOf(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function coversDate(item: CalendarItem, iso: string): boolean {
  if (!item.eventDate) return false;
  const end = item.endDate ?? item.eventDate;
  return item.eventDate <= iso && iso <= end;
}

export function EducationCalendarPage() {
  const { schoolId, canManage, canCoordinate } = useSchoolScope();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Kalender Pendidikan");
  const [documents, setDocuments] = useState<CalendarDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [years, setYears] = useState<Array<{ id: string; label: string }>>([]);
  const [yearId, setYearId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [detailItem, setDetailItem] = useState<ShownItem | null>(null);
  const [overflowItems, setOverflowItems] = useState<ShownItem[] | null>(null);
  const [calendarMode, setCalendarMode] = useState<"bulan" | "daftar">("bulan");
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visibleTabs = canCoordinate ? TABS : (["Kalender Pendidikan"] as const);

  function loadList() {
    if (!schoolId) return;
    api<{ documents: CalendarDocument[] }>(`/api/v1/schools/${schoolId}/education-calendar`)
      .then((data) => setDocuments(data.documents))
      .catch((caught: unknown) => setError(caught instanceof ApiClientError ? caught.message : "Kalender gagal dimuat."));
  }

  useEffect(() => { loadList(); }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !canManage) return;
    api<{ options: { years: Array<{ id: string; label: string }> } }>(`/api/v1/schools/${schoolId}/academic-options`)
      .then((data) => {
        setYears(data.options.years);
        setYearId((current) => current || data.options.years[0]?.id || "");
      })
      .catch(() => setYears([]));
  }, [schoolId, canManage]);

  useEffect(() => {
    if (!schoolId || !selectedId) return;
    api<Detail>(`/api/v1/schools/${schoolId}/education-calendar/${selectedId}`)
      .then((data) => setDetail(data))
      .catch((caught: unknown) => setError(caught instanceof ApiClientError ? caught.message : "Pratinjau gagal dimuat."));
  }, [schoolId, selectedId]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !yearId || !schoolId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const body = new FormData();
    body.set("academicYearId", yearId);
    body.set("file", file);
    try {
      const result = await api<Detail>(`/api/v1/schools/${schoolId}/education-calendar`, { method: "POST", body });
      setDetail(result);
      setSelectedId(result.document.id);
      setMessage(result.duplicate ? "Berkas yang sama sudah pernah diunggah. Data lama dipakai kembali." : "Pratinjau siap. Data akademik belum diubah.");
      loadList();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unggahan gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!editing || !detail || !schoolId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ document: CalendarDocument }>(`/api/v1/schools/${schoolId}/education-calendar/${detail.document.id}/items/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editing.title,
          category: editing.category,
          semesterKind: editing.category === "SEMESTER" ? editing.semesterKind : null,
          eventDate: editing.eventDate || null,
          endDate: editing.endDate || null,
          verification: editing.verification,
        }),
      });
      setDetail({ document: result.document, integration: detail.integration });
      setEditing(null);
      setMessage("Koreksi tersimpan pada pratinjau. Semester belum diubah.");
      const refreshed = await api<Detail>(`/api/v1/schools/${schoolId}/education-calendar/${result.document.id}`);
      setDetail(refreshed);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Koreksi gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  async function sendNote(event: FormEvent) {
    event.preventDefault();
    if (!detail || !schoolId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ document: CalendarDocument }>(`/api/v1/schools/${schoolId}/education-calendar/${detail.document.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      });
      setDetail({ ...detail, document: result.document });
      setNote("");
      setMessage("Masukan tersimpan. Tidak ada perubahan semester.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Masukan gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!detail || !schoolId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ document: CalendarDocument }>(`/api/v1/schools/${schoolId}/education-calendar/${detail.document.id}/publish`, { method: "POST" });
      setDetail({ ...detail, document: result.document });
      setMessage("Kalender disahkan untuk dilihat guru dan wali kelas. Semester belum diubah.");
      loadList();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Pengesahan gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function applyReady() {
    if (!detail?.integration || !schoolId) return;
    const creates = detail.integration.filter((item) => item.action === "CREATE").map((item) => item.semesterKind);
    if (creates.length === 0) {
      setError("Tidak ada semester baru yang dapat ditambahkan. Tanggal yang belum lengkap menunggu keputusan admin.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/schools/${schoolId}/education-calendar/${detail.document.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirm: true, creates }),
      });
      const refreshed = await api<Detail>(`/api/v1/schools/${schoolId}/education-calendar/${detail.document.id}`);
      setDetail(refreshed);
      setMessage("Semester yang belum ada disimpan sebagai nonaktif. Semester yang sudah ada tidak diubah.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Integrasi semester gagal.");
    } finally {
      setBusy(false);
    }
  }

  function showItem(document: CalendarDocument, item: CalendarItem): ShownItem {
    return { ...item, documentId: document.id, documentStatus: document.status, documentName: document.originalName, decision: document.decisionNumber };
  }

  const published = documents
    .filter((document) => document.status === "PUBLISHED")
    .flatMap((document) => document.items.map((item) => showItem(document, item)));
  const undatedDrafts = canManage
    ? documents.filter((document) => document.status === "DRAFT").flatMap((document) => document.items.filter((item) => !item.eventDate).map((item) => showItem(document, item)))
    : [];
  const firstDated = published.map((item) => item.eventDate).filter((value): value is string => Boolean(value)).sort()[0] ?? "";
  useEffect(() => {
    if (!firstDated) return;
    const [year, month] = firstDated.split("-").map(Number);
    if (year && month) setCursor({ year, month });
  }, [firstDated]);
  const activeCursor = cursor ?? { year: 2026, month: 7 };
  const cells = monthCells(activeCursor.year, activeCursor.month);
  const undated = [...published.filter((item) => !item.eventDate), ...undatedDrafts];

  async function correctUndated(item: ShownItem) {
    if (!schoolId || !canManage || item.documentStatus !== "DRAFT") return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Detail>(`/api/v1/schools/${schoolId}/education-calendar/${item.documentId}`);
      setDetail(result);
      setSelectedId(result.document.id);
      setDetailItem(null);
      setEditing(result.document.items.find((entry) => entry.id === item.id) ?? item);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Koreksi gagal dibuka.");
    } finally {
      setBusy(false);
    }
  }

  function moveMonth(delta: number) {
    setCursor((current) => {
      const base = current ?? activeCursor;
      const next = new Date(Date.UTC(base.year, base.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Kalender Pendidikan</h1>
        <p className="mt-1 text-sm leading-6 text-slate-600">Unggah dokumen sekolah, periksa hasil bacaan, lalu terapkan semester hanya setelah konfirmasi.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => (
          <button key={item} type="button" className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === item ? "bg-teal-800 text-white" : "border border-slate-300 bg-white text-slate-700"}`} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">{message}</p> : null}

      {tab === "Kalender Pendidikan" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
          {published.length === 0 ? <p className="text-sm text-slate-600">Kalender yang sudah disahkan belum tersedia.</p> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <button type="button" aria-label="Bulan sebelumnya" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" onClick={() => moveMonth(-1)}>
                    <span className="md:hidden" aria-hidden="true">‹</span>
                    <span className="hidden md:inline">Bulan sebelumnya</span>
                  </button>
                  <h2 className="min-w-0 flex-1 text-center text-base font-semibold md:text-lg">{MONTH_NAMES[activeCursor.month - 1]} {activeCursor.year}</h2>
                  <button type="button" aria-label="Bulan berikutnya" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" onClick={() => moveMonth(1)}>
                    <span className="md:hidden" aria-hidden="true">›</span>
                    <span className="hidden md:inline">Bulan berikutnya</span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={`rounded-xl px-3 py-2 text-sm ${calendarMode === "bulan" ? "bg-teal-800 text-white" : "border border-slate-300"}`} onClick={() => setCalendarMode("bulan")}>Kalender</button>
                  <button type="button" className={`rounded-xl px-3 py-2 text-sm ${calendarMode === "daftar" ? "bg-teal-800 text-white" : "border border-slate-300"}`} onClick={() => setCalendarMode("daftar")}>Daftar</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["KEGIATAN", "LIBUR", "ASESMEN", "RAPOR"] as const).map((category) => (
                  <span key={category} className={`rounded-full px-2 py-1 ${categoryClass(category)}`}>{labelCategory(category)}</span>
                ))}
              </div>
              {calendarMode === "bulan" ? (
                <div className="grid grid-cols-7 gap-px sm:gap-1">
                  {WEEKDAY_LABELS.map((label, index) => (
                    <div key={label} className="px-0.5 py-1 text-center text-[10px] font-medium text-slate-500 md:px-1 md:py-2 md:text-xs">
                      <span className="md:hidden">{WEEKDAY_SHORT[index]}</span>
                      <span className="hidden md:inline">{label}</span>
                    </div>
                  ))}
                  {cells.map((iso, index) => {
                    const dayItems = iso ? published.filter((item) => coversDate(item, iso)) : [];
                    const extra = dayItems.slice(2);
                    return (
                      <div key={iso ?? `empty-${index}`} className="min-h-16 rounded-lg border border-slate-100 bg-slate-50 p-0.5 md:min-h-24 md:rounded-xl md:p-1">
                        <p className="text-[10px] text-slate-500 md:text-xs">{iso ? Number(iso.slice(8)) : ""}</p>
                        <div className="mt-0.5 space-y-0.5">
                          {dayItems.slice(0, 2).map((item) => (
                            <button key={item.id} type="button" title={item.title} className={`block w-full truncate rounded px-0.5 py-0.5 text-left text-[10px] leading-tight md:text-[11px] ${categoryClass(item.category)}`} onClick={() => setDetailItem(item)}>{shortTitle(item.title)}</button>
                          ))}
                          {extra.length > 0 ? <button type="button" className="w-full truncate px-0.5 text-left text-[10px] font-medium text-slate-600" onClick={() => setOverflowItems(extra)}>+{extra.length} lainnya</button> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="space-y-3">
                  {published.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-left text-sm" onClick={() => setDetailItem(item)}>
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <p className="mt-1 text-slate-600">{labelCategory(item.category)} · {item.eventDate ?? "Tanggal belum lengkap"}{item.endDate ? ` sampai ${item.endDate}` : ""}</p>
                        <p className="mt-1 text-slate-500">Sumber: {item.documentName}{item.decision ? ` · ${item.decision}` : ""}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {undated.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-800">Belum punya tanggal lengkap</h3>
              <ul className="mt-2 space-y-2">
                {undated.map((item) => (
                  <li key={`${item.documentId}-${item.id}`} className="flex flex-wrap items-center gap-2">
                    <button type="button" className="text-left text-sm text-teal-800 underline" onClick={() => setDetailItem(item)}>{item.title}</button>
                    {canManage && item.documentStatus === "DRAFT" ? <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" onClick={() => void correctUndated(item)}>Koreksi</button> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "Upload & Integrasi" && canCoordinate ? (
        <section className="space-y-4">
          {canManage ? (
            <form className="rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(event) => void upload(event)}>
              <h2 className="font-semibold text-slate-900">Upload dokumen</h2>
              <p className="mt-1 text-sm text-slate-600">DOCX, XLSX, atau PDF berbasis teks, maksimal 2 MB. Pratinjau tidak menulis data akademik.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-slate-700">Tahun pelajaran
                  <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={yearId} onChange={(event) => setYearId(event.target.value)}>
                    <option value="">Pilih</option>
                    {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-700">Berkas
                  <input className="mt-1 block w-full text-sm" type="file" accept=".docx,.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
              <button type="submit" disabled={busy || !file || !yearId} className="mt-4 rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Unggah dan pratinjau</button>
            </form>
          ) : <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Wakil kurikulum dapat melihat pratinjau dan memberi masukan. Penerapan semester tetap pada admin sekolah.</p>}

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Dokumen sekolah</h2>
            <ul className="mt-3 space-y-2">
              {documents.map((document) => (
                <li key={document.id}>
                  <button type="button" className="text-left text-sm text-teal-800 underline" onClick={() => setSelectedId(document.id)}>{document.originalName} · {document.academicYearName} · {document.status === "PUBLISHED" ? "Disahkan" : "Draf"}</button>
                </li>
              ))}
              {documents.length === 0 ? <li className="text-sm text-slate-600">Belum ada unggahan.</li> : null}
            </ul>
          </div>

          {detail ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-900">Pratinjau {detail.document.originalName}</h2>
              <p className="mt-2 text-sm text-slate-600">Sumber: {detail.document.originalName}. Nomor keputusan: {detail.document.decisionNumber ?? "tidak tercantum"}. Tahun pada dokumen: {detail.document.extractedYear ?? "tidak tercantum"} ({detail.document.yearStatus}). NPSN: {detail.document.npsnStatus}.</p>
              {detail.document.warning ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{detail.document.warning}</p> : null}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2">Kegiatan</th><th>Tanggal</th><th>Kategori</th><th>Status</th><th>Sumber</th><th></th></tr></thead>
                  <tbody>
                    {detail.document.items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="py-2 pr-3">{item.title}</td>
                        <td className="pr-3">{item.eventDate ?? "Belum lengkap"}{item.endDate ? ` – ${item.endDate}` : ""}</td>
                        <td className="pr-3">{labelCategory(item.category)}</td>
                        <td className="pr-3">{item.verification === "PERLU_VERIFIKASI" ? "Perlu verifikasi" : "Terverifikasi"}{item.warning ? `. ${item.warning}` : ""}</td>
                        <td className="pr-3">{item.source ?? "dokumen"}</td>
                        <td>{canManage && detail.document.status === "DRAFT" ? <button type="button" className="text-teal-800 underline" onClick={() => setEditing(item)}>Koreksi</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.integration ? (
                <div className="mt-4 space-y-2">
                  {detail.integration.map((item) => (
                    <p key={item.semesterKind} className="text-sm text-slate-700">{item.semesterKind === "GANJIL" ? "Ganjil" : "Genap"}: {item.action === "CREATE" ? `siap ditambahkan ${item.startDate} sampai ${item.endDate}, nonaktif` : item.action === "REUSE" ? "memakai semester yang sudah ada" : item.reason}</p>
                  ))}
                </div>
              ) : null}
              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => void publish()}>Sahkan kalender</button>
                  <button type="button" disabled={busy} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => void applyReady()}>Terapkan semester yang belum ada</button>
                </div>
              ) : null}
              <div className="mt-5 space-y-2">
                {detail.document.notes.map((item) => <p key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-medium">{item.authorName}: </span>{item.body}</p>)}
                {canCoordinate ? (
                  <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void sendNote(event)}>
                    <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Masukan untuk admin sekolah" />
                    <button type="submit" disabled={busy || note.trim().length < 8} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Kirim masukan</button>
                  </form>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {tab === "Pengaturan Semester" && canCoordinate ? <SemestersPage /> : null}

      {overflowItems ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5">
            <h3 className="text-lg font-semibold">Kegiatan lain pada tanggal ini</h3>
            <ul className="mt-3 space-y-2">
              {overflowItems.map((item) => (
                <li key={item.id}>
                  <button type="button" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm" onClick={() => { setOverflowItems(null); setDetailItem(item); }}>{item.title}</button>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => setOverflowItems(null)}>Tutup</button>
            </div>
          </div>
        </div>
      ) : null}

      {detailItem ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5">
            <p className={`inline-flex rounded-full px-2 py-1 text-xs ${categoryClass(detailItem.category)}`}>{labelCategory(detailItem.category)}</p>
            <h3 className="mt-3 text-lg font-semibold">{detailItem.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{detailItem.eventDate ?? "Tanggal belum lengkap"}{detailItem.endDate ? ` sampai ${detailItem.endDate}` : ""}</p>
            <p className="mt-2 text-sm text-slate-600">{detailItem.verification === "PERLU_VERIFIKASI" ? "Perlu verifikasi" : "Terverifikasi"}{detailItem.warning ? `. ${detailItem.warning}` : ""}</p>
            <p className="mt-2 text-sm text-slate-500">Sumber: {detailItem.source ?? detailItem.documentName ?? "dokumen"}{detailItem.decision ? ` · ${detailItem.decision}` : ""}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {canManage && !detailItem.eventDate && detailItem.documentStatus === "DRAFT" ? <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => void correctUndated(detailItem)}>Koreksi</button> : null}
              <button type="button" className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => setDetailItem(null)}>Tutup</button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
          <form role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5" onSubmit={(event) => void saveItem(event)}>
            <h3 className="text-lg font-semibold">Koreksi hasil bacaan</h3>
            <p className="mt-1 text-sm text-slate-600">Koreksi ini hanya mengubah pratinjau. Semester, siswa, dan nilai tidak ikut berubah.</p>
            <label className="mt-4 block text-sm">Nama kegiatan
              <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Mulai
                <input type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.eventDate ?? ""} onChange={(event) => setEditing({ ...editing, eventDate: event.target.value || null })} />
              </label>
              <label className="text-sm">Selesai
                <input type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.endDate ?? ""} onChange={(event) => setEditing({ ...editing, endDate: event.target.value || null })} />
              </label>
            </div>
            <label className="mt-3 block text-sm">Kategori
              <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as CalendarItem["category"] })}>
                {CATEGORIES.map((item) => <option key={item} value={item}>{labelCategory(item)}</option>)}
              </select>
            </label>
            {editing.category === "SEMESTER" ? (
              <label className="mt-3 block text-sm">Jenis semester
                <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.semesterKind ?? ""} onChange={(event) => setEditing({ ...editing, semesterKind: event.target.value === "GENAP" ? "GENAP" : event.target.value === "GANJIL" ? "GANJIL" : null })}>
                  <option value="">Pilih</option>
                  <option value="GANJIL">Ganjil</option>
                  <option value="GENAP">Genap</option>
                </select>
              </label>
            ) : null}
            <label className="mt-3 block text-sm">Status
              <select className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={editing.verification} onChange={(event) => setEditing({ ...editing, verification: event.target.value as CalendarItem["verification"] })}>
                <option value="PERLU_VERIFIKASI">Perlu verifikasi</option>
                <option value="TERVERIFIKASI">Terverifikasi</option>
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setEditing(null)}>Batal</button>
              <button type="submit" disabled={busy} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white">Simpan koreksi</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
