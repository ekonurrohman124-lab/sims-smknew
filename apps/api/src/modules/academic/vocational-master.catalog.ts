export const SPECTRUM_SOURCE = "Kepmendikbudristek Nomor 244/M/2024";
export const STRUCTURE_SOURCE = "Permendikdasmen Nomor 13 Tahun 2025";
export const CP_SOURCE = "Keputusan Kepala BSKAP Nomor 046/H/KR/2025";

export type Phase = "E" | "F";
export type SubjectGroup = "UMUM" | "KEJURUAN";
export type SubjectScope = "LINTAS" | "PROGRAM" | "KONSENTRASI";
export type PlacementMode = "OTOMATIS" | "TIDAK_OTOMATIS";
export type JpTable = "Tabel 11" | "Tabel 12" | "Tabel 13";

export type JpAllocation = {
  gradeLevel: 10 | 11 | 12;
  phase: Phase;
  intracurricular: number;
  cocurricular: number;
  table: JpTable;
  source: typeof STRUCTURE_SOURCE;
};

export type ExpertiseFieldSeed = {
  code: string;
  name: string;
  source: typeof SPECTRUM_SOURCE;
};

export type ExpertiseProgramSeed = {
  code: string;
  name: string;
  fieldCode: string;
  aliases: string[];
  source: typeof SPECTRUM_SOURCE;
};

export type ExpertiseConcentrationSeed = {
  code: string;
  name: string;
  programCode: string;
  aliases: string[];
  schoolTrack: boolean;
  source: typeof SPECTRUM_SOURCE;
};

export type SubjectSeed = {
  code: string;
  name: string;
  group: SubjectGroup;
  scope: SubjectScope;
  programCode: string | null;
  concentrationCode: string | null;
  grades: Array<10 | 11 | 12>;
  placement: PlacementMode;
  allocations: JpAllocation[];
  nameSource: string;
};

export type CpSlot = {
  subjectCode: string;
  subjectName: string;
  phase: Phase;
  element: null;
  statement: null;
  source: typeof CP_SOURCE;
  decisionNumber: "046/H/KR/2025";
  year: 2025;
  annex: "III" | null;
  status: "PENDING_VERIFICATION";
};

export type ConfirmationItem = {
  code: string;
  message: string;
};

const structure = STRUCTURE_SOURCE;

function jp(gradeLevel: 10 | 11 | 12, phase: Phase, intracurricular: number, cocurricular: number, table: JpTable): JpAllocation {
  return { gradeLevel, phase, intracurricular, cocurricular, table, source: structure };
}

const agamaJp = [
  jp(10, "E", 108, 0, "Tabel 11"),
  jp(11, "F", 90, 18, "Tabel 12"),
  jp(12, "F", 32, 16, "Tabel 13"),
];

const continuousJp = [
  jp(10, "E", 108, 36, "Tabel 11"),
  jp(11, "F", 90, 18, "Tabel 12"),
  jp(12, "F", 48, 0, "Tabel 13"),
];

export const expertiseFields: ExpertiseFieldSeed[] = [
  { code: "2", name: "Teknologi Manufaktur dan Rekayasa", source: SPECTRUM_SOURCE },
  { code: "4", name: "Teknologi Informasi", source: SPECTRUM_SOURCE },
  { code: "8", name: "Bisnis dan Manajemen", source: SPECTRUM_SOURCE },
  { code: "9", name: "Pariwisata", source: SPECTRUM_SOURCE },
];

export const expertisePrograms: ExpertiseProgramSeed[] = [
  { code: "2.2", name: "Teknik Otomotif", fieldCode: "2", aliases: [], source: SPECTRUM_SOURCE },
  { code: "4.2", name: "Teknik Jaringan Komputer dan Telekomunikasi", fieldCode: "4", aliases: [], source: SPECTRUM_SOURCE },
  { code: "8.1", name: "Pemasaran", fieldCode: "8", aliases: [], source: SPECTRUM_SOURCE },
  { code: "8.3", name: "Akuntansi dan Keuangan Lembaga", fieldCode: "8", aliases: [], source: SPECTRUM_SOURCE },
  { code: "9.2", name: "Perhotelan", fieldCode: "9", aliases: [], source: SPECTRUM_SOURCE },
];

export const expertiseConcentrations: ExpertiseConcentrationSeed[] = [
  { code: "2.2.2", name: "Teknik Sepeda Motor", programCode: "2.2", aliases: ["TSM", "TO", "TBSM"], schoolTrack: true, source: SPECTRUM_SOURCE },
  { code: "4.2.1", name: "Teknik Komputer dan Jaringan", programCode: "4.2", aliases: ["TJKT", "TJKJ", "TKJ", "TJK"], schoolTrack: true, source: SPECTRUM_SOURCE },
  { code: "4.2.2", name: "Teknik Jaringan Akses Telekomunikasi", programCode: "4.2", aliases: [], schoolTrack: false, source: SPECTRUM_SOURCE },
  { code: "4.2.3", name: "Teknik Transmisi Telekomunikasi", programCode: "4.2", aliases: [], schoolTrack: false, source: SPECTRUM_SOURCE },
  { code: "8.1.1", name: "Bisnis Digital", programCode: "8.1", aliases: [], schoolTrack: false, source: SPECTRUM_SOURCE },
  { code: "8.1.2", name: "Bisnis Retail", programCode: "8.1", aliases: ["BDP", "PM", "PEMASARAN", "BD"], schoolTrack: true, source: SPECTRUM_SOURCE },
  { code: "8.3.3", name: "Akuntansi", programCode: "8.3", aliases: ["AKA", "AK", "AKUN", "AKL"], schoolTrack: true, source: SPECTRUM_SOURCE },
  { code: "9.2.1", name: "Perhotelan", programCode: "9.2", aliases: ["PERHOTELAN", "PHT", "PH"], schoolTrack: true, source: SPECTRUM_SOURCE },
];

const religion = [
  ["AGM-PAI", "Pendidikan Agama Islam dan Budi Pekerti"],
  ["AGM-PKR", "Pendidikan Agama Kristen dan Budi Pekerti"],
  ["AGM-KAT", "Pendidikan Agama Katolik dan Budi Pekerti"],
  ["AGM-HIN", "Pendidikan Agama Hindu dan Budi Pekerti"],
  ["AGM-BUD", "Pendidikan Agama Buddha dan Budi Pekerti"],
  ["AGM-KHO", "Pendidikan Agama Khonghucu dan Budi Pekerti"],
] as const;

const art = [
  ["SENI-MUS", "Seni Musik"],
  ["SENI-RUP", "Seni Rupa"],
  ["SENI-TEA", "Seni Teater"],
  ["SENI-TAR", "Seni Tari"],
] as const;

const lampiranIII = new Set(["DD-OTO", "DD-TJKT", "DD-PM", "DD-AKL", "DD-PHT"]);

function subject(seed: SubjectSeed): SubjectSeed {
  return seed;
}

export const vocationalSubjects: SubjectSeed[] = [
  ...religion.map(([code, name]) => subject({
    code, name, group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11, 12], placement: "TIDAK_OTOMATIS", allocations: agamaJp, nameSource: structure,
  })),
  subject({
    code: "PP", name: "Pendidikan Pancasila", group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11, 12], placement: "OTOMATIS",
    allocations: [jp(10, "E", 72, 0, "Tabel 11"), jp(11, "F", 54, 18, "Tabel 12"), jp(12, "F", 32, 0, "Tabel 13")],
    nameSource: structure,
  }),
  subject({
    code: "BIN", name: "Bahasa Indonesia", group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11, 12], placement: "OTOMATIS",
    allocations: [jp(10, "E", 108, 36, "Tabel 11"), jp(11, "F", 90, 18, "Tabel 12"), jp(12, "F", 32, 16, "Tabel 13")],
    nameSource: structure,
  }),
  subject({
    code: "PJOK", name: "Pendidikan Jasmani, Olahraga, dan Kesehatan", group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11], placement: "OTOMATIS",
    allocations: [jp(10, "E", 108, 0, "Tabel 11"), jp(11, "F", 54, 18, "Tabel 12")],
    nameSource: structure,
  }),
  subject({
    code: "SEJ", name: "Sejarah", group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11], placement: "OTOMATIS",
    allocations: [jp(10, "E", 72, 0, "Tabel 11"), jp(11, "F", 54, 18, "Tabel 12")],
    nameSource: structure,
  }),
  ...art.map(([code, name]) => subject({
    code, name, group: "UMUM", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10], placement: "TIDAK_OTOMATIS", allocations: [jp(10, "E", 72, 0, "Tabel 11")], nameSource: structure,
  })),
  subject({
    code: "MTK", name: "Matematika", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11, 12], placement: "OTOMATIS", allocations: continuousJp, nameSource: structure,
  }),
  subject({
    code: "BIG", name: "Bahasa Inggris", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10, 11, 12], placement: "OTOMATIS",
    allocations: [jp(10, "E", 108, 36, "Tabel 11"), jp(11, "F", 108, 36, "Tabel 12"), jp(12, "F", 64, 0, "Tabel 13")],
    nameSource: structure,
  }),
  subject({
    code: "INF", name: "Informatika", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 108, 36, "Tabel 11")], nameSource: structure,
  }),
  subject({
    code: "IPAS", name: "Projek Ilmu Pengetahuan Alam dan Sosial", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 180, 36, "Tabel 11")], nameSource: structure,
  }),
  subject({
    code: "DD-OTO", name: "Dasar-dasar Teknik Otomotif", group: "KEJURUAN", scope: "PROGRAM", programCode: "2.2", concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 432, 0, "Tabel 11")], nameSource: CP_SOURCE,
  }),
  subject({
    code: "DD-TJKT", name: "Dasar-dasar Teknik Jaringan Komputer dan Telekomunikasi", group: "KEJURUAN", scope: "PROGRAM", programCode: "4.2", concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 432, 0, "Tabel 11")], nameSource: CP_SOURCE,
  }),
  subject({
    code: "DD-PM", name: "Dasar-dasar Pemasaran", group: "KEJURUAN", scope: "PROGRAM", programCode: "8.1", concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 432, 0, "Tabel 11")], nameSource: CP_SOURCE,
  }),
  subject({
    code: "DD-AKL", name: "Dasar-dasar Akuntansi dan Keuangan Lembaga", group: "KEJURUAN", scope: "PROGRAM", programCode: "8.3", concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 432, 0, "Tabel 11")], nameSource: CP_SOURCE,
  }),
  subject({
    code: "DD-PHT", name: "Dasar-dasar Perhotelan", group: "KEJURUAN", scope: "PROGRAM", programCode: "9.2", concentrationCode: null,
    grades: [10], placement: "OTOMATIS", allocations: [jp(10, "E", 432, 0, "Tabel 11")], nameSource: CP_SOURCE,
  }),
  subject({
    code: "KIK", name: "Kreativitas, Inovasi, dan Kewirausahaan", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [11, 12], placement: "OTOMATIS",
    allocations: [jp(11, "F", 180, 0, "Tabel 12"), jp(12, "F", 80, 0, "Tabel 13")],
    nameSource: structure,
  }),
  subject({
    code: "PKL", name: "Praktik Kerja Lapangan", group: "KEJURUAN", scope: "LINTAS", programCode: null, concentrationCode: null,
    grades: [12], placement: "OTOMATIS", allocations: [jp(12, "F", 736, 0, "Tabel 13")], nameSource: structure,
  }),
  ...expertiseConcentrations.filter((item) => item.schoolTrack).map((item) => subject({
    code: `KN-${item.code.replaceAll(".", "")}`,
    name: item.name,
    group: "KEJURUAN",
    scope: "KONSENTRASI",
    programCode: item.programCode,
    concentrationCode: item.code,
    grades: [11, 12],
    placement: "OTOMATIS",
    allocations: [jp(11, "F", 648, 0, "Tabel 12"), jp(12, "F", 352, 0, "Tabel 13")],
    nameSource: structure,
  })),
];

export const curriculumBlueprint = {
  code: "KM-2026",
  name: "Kurikulum Merdeka 2026/2027",
  description: "Spektrum Kepmendikbudristek 244/M/2024. Struktur dan JP Permendikdasmen 13 Tahun 2025 Tabel 11-13. Rumusan CP Kepka BSKAP 046/H/KR/2025 belum disimpan. Bisnis Digital tidak diaktifkan. Pilihan, muatan lokal, seni, dan agama menunggu konfirmasi sekolah.",
};

export const curriculumReviewNotes = [
  "Enam mata pelajaran agama tersedia. Peserta didik mengikuti satu agama. Penempatan per kelas tidak dilakukan otomatis.",
  "Sekolah menyediakan minimal satu dari Seni Musik, Seni Rupa, Seni Teater, atau Seni Tari. Jenis yang dibuka belum dikonfirmasi.",
  "Mata pelajaran pilihan tetap konfigurasi sekolah. Kelas XI 144 JP dan kelas XII 64 JP intrakurikuler belum diberi nama. Koding dan Kecerdasan Artifisial 72 JP pada kelas X hanya dibuka jika sekolah menyediakannya.",
  "Muatan lokal paling banyak 72 JP pada kelas X dan XI, serta 32 JP pada kelas XII. Nama muatan lokal belum ditetapkan sekolah.",
  "Nama KIK tetap Kreativitas, Inovasi, dan Kewirausahaan sesuai katalog Permendikdasmen Nomor 13 Tahun 2025. Sekolah masih perlu memvalidasi nama ini. Nama tidak diubah dan belum disahkan.",
];

export const schoolConfirmations: ConfirmationItem[] = [
  { code: "TJKT-LAIN", message: "Alias TJKT, TJKJ, TKJ, dan TJK dipetakan ke konsentrasi Teknik Komputer dan Jaringan. Teknik Jaringan Akses Telekomunikasi dan Teknik Transmisi Telekomunikasi ada pada spektrum, tetapi tidak dibuka." },
  { code: "AGAMA", message: "Enam mata pelajaran agama tersedia. Peserta didik mengikuti satu agama. Penempatan per kelas tidak dilakukan otomatis." },
  { code: "SENI", message: "Sekolah menyediakan minimal satu dari Seni Musik, Seni Rupa, Seni Teater, atau Seni Tari. Jenis yang dibuka belum dikonfirmasi." },
  { code: "PILIHAN", message: "Mata pelajaran pilihan tetap konfigurasi sekolah. Kelas XI 144 JP dan kelas XII 64 JP intrakurikuler belum diberi nama. Koding dan Kecerdasan Artifisial 72 JP pada kelas X hanya dibuka jika sekolah menyediakannya." },
  { code: "MULOK", message: "Muatan lokal paling banyak 72 JP pada kelas X dan XI, serta 32 JP pada kelas XII. Nama muatan lokal belum ditetapkan sekolah." },
  { code: "IPAS", message: "Proporsi aspek Ilmu Pengetahuan Alam dan Ilmu Pengetahuan Sosial pada Projek IPAS menyesuaikan program keahlian dan belum dikonfirmasi." },
  { code: "CP", message: "Kepka BSKAP 046/H/KR/2025 sudah diidentifikasi dan mencabut 032/H/KR/2024. Rumusan serta elemen tidak disimpan karena kutipan naskah tidak utuh." },
];

export function cpSlots(): CpSlot[] {
  const slots: CpSlot[] = [];
  for (const item of vocationalSubjects) {
    const phases = new Set<Phase>();
    for (const grade of item.grades) phases.add(grade === 10 ? "E" : "F");
    for (const phase of phases) {
      slots.push({
        subjectCode: item.code,
        subjectName: item.name,
        phase,
        element: null,
        statement: null,
        source: CP_SOURCE,
        decisionNumber: "046/H/KR/2025",
        year: 2025,
        annex: lampiranIII.has(item.code) ? "III" : null,
        status: "PENDING_VERIFICATION",
      });
    }
  }
  return slots;
}

export function resolveSchoolAlias(alias: string): { programCode: string | null; concentrationCode: string | null; status: "COCOK" | "PERLU_KONFIRMASI" } {
  const key = alias.replace(/\s+/g, " ").trim().toLocaleUpperCase("id-ID");
  const concentration = expertiseConcentrations.find((item) => item.aliases.includes(key));
  if (concentration) return { programCode: concentration.programCode, concentrationCode: concentration.code, status: "COCOK" };
  const program = expertisePrograms.find((item) => item.aliases.includes(key));
  if (program) return { programCode: program.code, concentrationCode: null, status: "PERLU_KONFIRMASI" };
  return { programCode: null, concentrationCode: null, status: "PERLU_KONFIRMASI" };
}

export function assertCatalogIntegrity(): void {
  const codes = [
    ...expertiseFields.map((item) => `F:${item.code}`),
    ...expertisePrograms.map((item) => `P:${item.code}`),
    ...expertiseConcentrations.map((item) => `K:${item.code}`),
    ...vocationalSubjects.map((item) => `M:${item.code}`),
  ];
  if (new Set(codes).size !== codes.length) throw new Error("Katalog master kejuruan memiliki kode ganda.");
  for (const item of [...expertiseFields, ...expertisePrograms, ...expertiseConcentrations, ...vocationalSubjects]) {
    if (item.code.length > 16) throw new Error("Kode katalog melebihi 16 karakter.");
  }
  for (const program of expertisePrograms) {
    if (!expertiseFields.some((field) => field.code === program.fieldCode)) throw new Error("Program tidak memiliki bidang.");
  }
  for (const concentration of expertiseConcentrations) {
    if (!expertisePrograms.some((program) => program.code === concentration.programCode)) throw new Error("Konsentrasi tidak memiliki program.");
  }
  if (expertiseConcentrations.filter((item) => item.schoolTrack).length !== 5) {
    throw new Error("Konsentrasi sekolah harus lima.");
  }
  const retail = expertiseConcentrations.find((item) => item.code === "8.1.2");
  const digital = expertiseConcentrations.find((item) => item.code === "8.1.1");
  if (!retail?.schoolTrack || retail.aliases.join(",") !== "BDP,PM,PEMASARAN,BD") {
    throw new Error("Alias BDP harus menempel pada Bisnis Retail.");
  }
  if (digital?.schoolTrack || (digital?.aliases.length ?? 0) > 0) {
    throw new Error("Bisnis Digital tidak diaktifkan untuk sekolah ini.");
  }
  if (vocationalSubjects.some((item) => item.concentrationCode === "8.1.1" || item.code === "PKK")) {
    throw new Error("Mapel Bisnis Digital atau nama kurikulum lama masih tersimpan.");
  }
  for (const item of vocationalSubjects) {
    if (item.scope === "LINTAS" && (item.programCode || item.concentrationCode)) throw new Error("Mapel lintas terikat pada satu kejuruan.");
    if (item.scope === "KONSENTRASI" && !item.concentrationCode) throw new Error("Mapel konsentrasi tidak memiliki konsentrasi.");
  }
  if (cpSlots().some((slot) => slot.statement !== null || slot.status !== "PENDING_VERIFICATION")) {
    throw new Error("Slot CP harus tetap pending dan tanpa rumusan.");
  }
  if (curriculumBlueprint.description.length > 500) throw new Error("Deskripsi kurikulum melebihi batas.");
}
