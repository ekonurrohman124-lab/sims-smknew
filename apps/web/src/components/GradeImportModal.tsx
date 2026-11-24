import type { DetectedImportColumn, ParsedWorkbookResult } from "../lib/gradeImport.ts";

type Props = {
  importData: ParsedWorkbookResult | null;
  importSheetName: string;
  detectedCols: DetectedImportColumn[];
  selectedColKeys: string[];
  importing: boolean;
  onFile: (file: File) => void;
  onSelectSheet: (sheetName: string) => void;
  onToggleKey: (key: string, checked: boolean) => void;
  onToggleAll: () => void;
  onClose: () => void;
  onApply: () => void;
};

export function GradeImportModal(props: Props) {
  const { importData, importSheetName, detectedCols, selectedColKeys, importing } = props;
  const fillable = detectedCols.filter((c) => c.matchedCount > 0);
  const allChecked = fillable.length > 0 && selectedColKeys.length === fillable.length;
  return (
    <>
      <h2 id="grade-action-title" className="text-lg font-semibold text-slate-900">Import Nilai Excel / Spreadsheet</h2>
      <p className="mt-1 text-xs leading-5 text-slate-600">Unggah <strong>.xlsx / .xlsm / .xls / .ods / .csv</strong>. Seluruh sheet (Formatif TP, Sumatif, STS, SAS) otomatis terdeteksi &amp; tersimpan.</p>
      <div className="mt-3 space-y-2.5">
        <label className="block text-xs font-semibold text-slate-700">Pilih File Nilai
          <input type="file" accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onFile(f); }} className="mt-1 block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
        </label>
        {importData?.stats ? (
          <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-700">
            Pratinjau: {importData.stats.accepted} nilai siap disimpan, {importData.stats.skippedEmpty} kosong dilewati, {importData.stats.rejectedInvalid} di luar rentang 0–100, {importData.stats.unmatchedNames.length} nama tidak ada di kelas ini.
          </p>
        ) : null}
        {importData && importData.sheetNames.length > 0 ? (
          <label className="block text-xs font-semibold text-slate-700">Pilih Sheet Workbook
            <select value={importSheetName} onChange={(e) => props.onSelectSheet(e.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-normal text-slate-800">
              {importData.sheetNames.length > 1 ? <option value="__ALL__">Semua Sheet (Gabungan Otomatis)</option> : null}
              {importData.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {detectedCols.length > 0 ? (
        <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-teal-950">Kolom Terdeteksi ({selectedColKeys.length}/{detectedCols.length} dipilih)</p>
            <button type="button" onClick={props.onToggleAll} className="rounded-md border border-teal-700 bg-white px-2.5 py-1 text-[11px] font-semibold text-teal-900 hover:bg-teal-100">
              {allChecked ? "Batal Centang Semua" : "Centang Semua"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-teal-900">Tujuan Pembelajaran (TP) yang belum ada dibuat otomatis dan nilai langsung tersimpan.</p>
          <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {detectedCols.map((col) => (
              <label key={col.key} className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <input type="checkbox" checked={selectedColKeys.includes(col.key)} disabled={col.matchedCount === 0} onChange={(e) => props.onToggleKey(col.key, e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-teal-800" />
                  <span>{col.label}</span>
                </span>
                <span className={col.matchedCount > 0 ? "text-[11px] font-semibold text-teal-800" : "text-[11px] text-slate-400"}>{col.matchedCount} siswa</span>
              </label>
            ))}
          </div>
        </div>
      ) : importData ? (
        <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">Tidak ada kolom nilai yang cocok dengan daftar siswa kelas ini pada sheet tersebut.</p>
      ) : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={props.onClose} disabled={importing} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Batal</button>
        <button type="button" disabled={importing || selectedColKeys.length === 0} onClick={props.onApply} className="h-9 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-60">
          {importing ? "Menyimpan Otomatis..." : `Terapkan & Simpan (${selectedColKeys.length} Kolom)`}
        </button>
      </div>
    </>
  );
}
