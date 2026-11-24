import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { PageResult } from "@sims/shared";
import { ApiClientError, api } from "../../lib/api.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { useToast } from "../ui/toast.tsx";
import { gridCell, gridHeadCell, gridRow, gridTable, gridTableFrame } from "./gridTable.ts";

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string | boolean;
  placeholder?: string;
  hint?: string;
};

export type ColumnDef = {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};

type DataScreenProps = {
  title: string;
  description: string;
  endpoint: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  canWrite: boolean;
  reloadToken?: number;
  onChanged?: () => void;
  creatable?: boolean;
  editable?: boolean;
  deletable?: boolean;
  extraActions?: (row: Record<string, unknown>) => ReactNode;
  actions?: ReactNode;
  emptyTitle?: string;
  emptyDetail?: string;
  layout?: "default" | "grid";
  queryParams?: Record<string, string>;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  stackOnMobile?: boolean;
  initialPageSize?: 10 | 25 | 50;
};

const inputClass = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700";

function display(row: Record<string, unknown>, column: ColumnDef): ReactNode {
  if (column.render) return column.render(row);
  const value = row[column.key];
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function DataScreen({
  title,
  description,
  endpoint,
  columns,
  fields,
  canWrite,
  reloadToken = 0,
  onChanged,
  creatable = true,
  editable = true,
  deletable = true,
  extraActions,
  actions,
  emptyTitle = "Belum ada data",
  emptyDetail = "Data yang cocok dengan pencarian belum tersedia.",
  layout = "grid",
  queryParams,
  searchPlaceholder = "Cari",
  toolbar,
  stackOnMobile = false,
  initialPageSize = 10,
}: DataScreenProps) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(initialPageSize);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const filterKey = JSON.stringify(queryParams ?? {});

  useEffect(() => {
    setPage(1);
  }, [filterKey, query]);

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
    const extra = JSON.parse(filterKey) as Record<string, string>;
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
    api<PageResult<Record<string, unknown>>>(`${endpoint}?${params.toString()}`)
      .then((data) => {
        if (!active) return;
        setRows(data.items);
        setTotal(data.total);
        setError("");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof ApiClientError ? caught.message : "Data gagal dimuat.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, query, page, pageSize, reloadToken, tick, filterKey]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function openCreate() {
    const next: Record<string, string | boolean> = {};
    for (const field of fields) next[field.name] = field.defaultValue ?? (field.type === "checkbox" ? false : "");
    setForm(next);
    setEditing(null);
    setError("");
  }

  function openEdit(row: Record<string, unknown>) {
    const next: Record<string, string | boolean> = {};
    for (const field of fields) {
      const value = row[field.name];
      next[field.name] = field.type === "checkbox" ? Boolean(value) : value === null || value === undefined ? "" : String(value);
    }
    setForm(next);
    setEditing(row);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = form[field.name];
      if (field.type === "checkbox") payload[field.name] = Boolean(value);
      else if (field.type === "number") payload[field.name] = value === "" ? null : Number(value);
      else payload[field.name] = value === "" ? null : value;
      if (field.required && (payload[field.name] === null || payload[field.name] === "")) {
        setError(`${field.label} wajib diisi.`);
        return;
      }
    }
    setSaving(true);
    try {
      if (editing && typeof editing.id === "string") await api(`${endpoint}/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setEditing(undefined);
      setError("");
      toast("Data tersimpan.");
      onChanged?.();
      setPage(1);
      setTick((current) => current + 1);
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : "Data gagal disimpan.";
      setError(message);
      toast(message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await api(`${endpoint}/${id}`, { method: "DELETE" });
      setConfirmId(null);
      setError("");
      toast("Data dihapus.");
      onChanged?.();
      setPage(1);
      setTick((current) => current + 1);
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : "Data gagal dihapus.";
      setError(message);
      toast(message, "err");
    } finally {
      setSaving(false);
    }
  }

  const grid = layout === "grid";

  return (
    <section className={grid ? "min-w-0 space-y-4" : "space-y-4"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {actions || (canWrite && creatable) ? (
          <div className="flex flex-wrap gap-2">
            {actions}
            {canWrite && creatable ? (
              <button type="button" onClick={openCreate} className="rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white">
                Tambah
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          value={query}
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        {toolbar}
        <label className="block text-sm text-slate-600">
          Tampilkan
          <select
            value={pageSize}
            aria-label="Jumlah baris"
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value) as 10 | 25 | 50);
            }}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>
      {error && editing === undefined ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}
      {!loading && rows.length === 0 ? <EmptyState title={emptyTitle} detail={emptyDetail} /> : null}
      {rows.length > 0 && grid && stackOnMobile ? (
        <div className="space-y-3 md:hidden">
          {rows.map((row) => (
            <article key={String(row.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
              {columns.map((column) => (
                <p key={column.key} className="text-sm text-slate-700">
                  <span className="text-slate-400">{column.label}: </span>
                  {display(row, column)}
                </p>
              ))}
              {canWrite ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {extraActions?.(row)}
                  {editable ? <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => openEdit(row)}>Ubah</button> : null}
                  {deletable ? <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={() => setConfirmId(String(row.id))}>Hapus</button> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {rows.length > 0 && grid ? (
        <div className={`${gridTableFrame} ${stackOnMobile ? "hidden md:block" : ""}`}>
          <table className={gridTable}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={`${gridHeadCell} ${column.headerClassName ?? ""}`}>{column.label}</th>
                ))}
                {canWrite ? <th className={`${gridHeadCell} w-36`}>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className={gridRow}>
                  {columns.map((column) => (
                    <td key={column.key} className={`${gridCell} ${column.cellClassName ?? ""}`}>{display(row, column)}</td>
                  ))}
                  {canWrite ? (
                    <td className={gridCell}>
                      <div className="flex flex-wrap gap-2">
                        {extraActions?.(row)}
                        {editable ? <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={() => openEdit(row)}>Ubah</button> : null}
                        {deletable ? <button type="button" className="rounded-lg border border-red-200 px-2 py-1 text-red-700" onClick={() => setConfirmId(String(row.id))}>Hapus</button> : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 0 && !grid ? (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className="px-3 py-2 font-medium">{column.label}</th>
                  ))}
                  {canWrite ? <th className="px-3 py-2 font-medium">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-t border-slate-100">
                    {columns.map((column) => (
                      <td key={column.key} className="px-3 py-3">{display(row, column)}</td>
                    ))}
                    {canWrite ? (
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {extraActions?.(row)}
                          {editable ? <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={() => openEdit(row)}>Ubah</button> : null}
                          {deletable ? <button type="button" className="rounded-lg border border-red-200 px-2 py-1 text-red-700" onClick={() => setConfirmId(String(row.id))}>Hapus</button> : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <article key={String(row.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
                {columns.map((column) => (
                  <p key={column.key} className="text-sm text-slate-700">
                    <span className="text-slate-400">{column.label}: </span>
                    {display(row, column)}
                  </p>
                ))}
                {canWrite ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {extraActions?.(row)}
                    {editable ? <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => openEdit(row)}>Ubah</button> : null}
                    {deletable ? <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={() => setConfirmId(String(row.id))}>Hapus</button> : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <p>{total} data</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Sebelumnya</button>
          <span>{page}/{pageCount}</span>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Berikutnya</button>
        </div>
      </div>
      {editing !== undefined ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
          <form onSubmit={(event) => void save(event)} role="dialog" aria-modal="true" className="flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <header className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold">{editing ? "Ubah data" : "Tambah data"}</h2>
              <p className="mt-1 text-sm text-slate-500">Lengkapi isian, lalu simpan. Pesan validasi tampil di dalam jendela ini.</p>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
              {fields.map((field) => (
                <label key={field.name} className="block text-sm font-medium text-slate-700">
                  {field.label}
                  {field.type === "checkbox" ? (
                    <input type="checkbox" className="ml-2" checked={Boolean(form[field.name])} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.checked }))} />
                  ) : field.type === "select" ? (
                    <select className={inputClass} value={String(form[field.name] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))} required={field.required}>
                      <option value="">Pilih</option>
                      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input className={inputClass} type={field.type} value={String(form[field.name] ?? "")} required={field.required} placeholder={field.placeholder} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))} />
                  )}
                  {field.hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{field.hint}</span> : null}
                </label>
              ))}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm" onClick={() => setEditing(undefined)}>Batal</button>
              <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Menyimpan..." : "Simpan"}</button>
            </footer>
          </form>
        </div>
      ) : null}
      {confirmId ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <h2 className="text-lg font-semibold">Hapus data ini?</h2>
            <p className="mt-2 text-sm text-slate-500">Data yang masih dipakai tidak dapat dihapus.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={() => setConfirmId(null)}>Batal</button>
              <button type="button" className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => void remove(confirmId)}>Hapus</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
