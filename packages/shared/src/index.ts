export const ROLE_CODES = [
  "SYSTEM_OWNER",
  "ADMIN_SEKOLAH",
  "WAKAKUR",
  "KEPALA_SEKOLAH",
  "GURU_MAPEL",
  "WALI_KELAS",
  "TU",
  "KOMITE_SEKOLAH",
  "WAKA_KESISWAAN",
  "WAKA_SARPRAS",
  "WAKA_HUMAS",
  "BENDAHARA",
  "OPERATOR_SEKOLAH",
  "KAPROG",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export type RoleScope = "PLATFORM" | "SCHOOL";

export type RoleDefinition = {
  code: RoleCode;
  name: string;
  description: string;
  scope: RoleScope;
};

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: "SYSTEM_OWNER",
    name: "Pemilik Sistem",
    description: "Akses platform untuk seluruh sekolah",
    scope: "PLATFORM",
  },
  {
    code: "ADMIN_SEKOLAH",
    name: "Admin Sekolah",
    description: "Mengelola data operasional satu sekolah",
    scope: "SCHOOL",
  },
  {
    code: "WAKAKUR",
    name: "Wakil Kepala Kurikulum",
    description: "Wakil kepala sekolah bidang kurikulum",
    scope: "SCHOOL",
  },
  {
    code: "KEPALA_SEKOLAH",
    name: "Kepala Sekolah",
    description: "Pimpinan sekolah",
    scope: "SCHOOL",
  },
  {
    code: "GURU_MAPEL",
    name: "Guru Mata Pelajaran",
    description: "Pengajar mata pelajaran",
    scope: "SCHOOL",
  },
  {
    code: "WALI_KELAS",
    name: "Wali Kelas",
    description: "Wali kelas siswa",
    scope: "SCHOOL",
  },
  {
    code: "TU",
    name: "Tata Usaha",
    description: "Petugas tata usaha sekolah",
    scope: "SCHOOL",
  },
  {
    code: "KOMITE_SEKOLAH",
    name: "Komite Sekolah",
    description: "Unsur komite pertimbangan dan pengawasan sekolah",
    scope: "SCHOOL",
  },
  {
    code: "WAKA_KESISWAAN",
    name: "Wakil Kepala Kesiswaan",
    description: "Wakil kepala sekolah bidang kesiswaan",
    scope: "SCHOOL",
  },
  {
    code: "WAKA_SARPRAS",
    name: "Wakil Kepala Sarana Prasarana",
    description: "Wakil kepala sekolah bidang sarana dan prasarana",
    scope: "SCHOOL",
  },
  {
    code: "WAKA_HUMAS",
    name: "Wakil Kepala Humas",
    description: "Wakil kepala sekolah bidang hubungan masyarakat dan industri",
    scope: "SCHOOL",
  },
  {
    code: "BENDAHARA",
    name: "Bendahara Sekolah",
    description: "Pengelola administrasi keuangan, BOS, komite, atau barang",
    scope: "SCHOOL",
  },
  {
    code: "OPERATOR_SEKOLAH",
    name: "Operator Sekolah",
    description: "Operator pendataan dan administrasi sistem sekolah",
    scope: "SCHOOL",
  },
  {
    code: "KAPROG",
    name: "Kepala Program Keahlian",
    description: "Koordinator jurusan / program keahlian SMK",
    scope: "SCHOOL",
  },
];

export const AUDIT_READER_ROLES = ["ADMIN_SEKOLAH", "KEPALA_SEKOLAH", "TU"] as const satisfies readonly RoleCode[];

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}

export type AssignmentDto = {
  roleCode: RoleCode;
  roleName: string;
  scope: RoleScope;
  schoolId: string | null;
  schoolName: string | null;
};

export type AuthUserDto = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  assignments: AssignmentDto[];
};

export type TeacherAccountResult = {
  item: TeacherDto;
  created: boolean;
  temporaryPassword: string | null;
};

export type LoginResponse = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: AuthUserDto;
};

export type SchoolAccessStatus = "AKTIF" | "NONAKTIF" | "DITANGGUHKAN";

export type SchoolDto = {
  id: string;
  name: string;
  npsn: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  website: string | null;
  accreditation: string | null;
  principalName: string | null;
  stsEnabled: boolean;
  sasEnabled: boolean;
  requireUh: boolean;
  requireT1: boolean;
  requireT2: boolean;
  requireT3: boolean;
  requireSummative: boolean;
  requireSts: boolean;
  requireSas: boolean;
  isActive: boolean;
  accessStatus: SchoolAccessStatus;
};

export type AcademicPeriodDto = {
  id: string;
  schoolId: string;
  academicYearId: string | null;
  academicYearName: string | null;
  name: string;
  semesterKind: "GANJIL" | "GENAP" | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type AcademicYearDto = {
  id: string;
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

export type ExpertiseFieldDto = {
  id: string;
  schoolId: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type ExpertiseProgramDto = {
  id: string;
  schoolId: string;
  fieldId: string;
  fieldName: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type ExpertiseConcentrationDto = {
  id: string;
  schoolId: string;
  programId: string;
  programName: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type SchoolUserRoleDto = {
  code: RoleCode;
  name: string;
};

export type SchoolUserDto = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  teacherId: string | null;
  teacherName: string | null;
  roles: SchoolUserRoleDto[];
};

export type SchoolUserWriteResult = {
  item: SchoolUserDto;
  created: boolean;
  temporaryPassword: string | null;
};

export type LinkableTeacherDto = {
  id: string;
  name: string;
  email: string | null;
  userId: string | null;
  userEmail: string | null;
};

export type TeacherDto = {
  id: string;
  schoolId: string;
  userId: string | null;
  userName: string | null;
  nip: string | null;
  nuptk: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  email: string | null;
  phone: string | null;
  isActive: boolean;
  loginEmail: string | null;
  roleCodes: Array<"GURU_MAPEL" | "WALI_KELAS">;
};

export type TeacherLinkStatus = "TERHUBUNG" | "BELUM_TERHUBUNG";

export type TeacherRosterDto = Omit<TeacherDto, "gender"> & {
  gender: TeacherDto["gender"] | null;
  linkStatus: TeacherLinkStatus | null;
};

export type SchoolClassDto = {
  id: string;
  schoolId: string;
  academicYearId: string;
  academicYearName: string;
  concentrationId: string | null;
  concentrationName: string | null;
  name: string;
  gradeLevel: number;
  capacity: number;
  isActive: boolean;
};

export type StudentDto = {
  id: string;
  schoolId: string;
  nisn: string;
  nis: string | null;
  name: string;
  gender: "LAKI_LAKI" | "PEREMPUAN";
  birthPlace: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  classId: string | null;
  className: string | null;
  concentrationId: string | null;
  concentrationName: string | null;
  isActive: boolean;
};

export type SubjectDto = {
  id: string;
  schoolId: string;
  code: string;
  name: string;
  category: "UMUM" | "KEJURUAN";
  isActive: boolean;
};

export type TeachingAssignmentDto = {
  id: string;
  schoolId: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  academicPeriodId: string;
  periodName: string;
};

export type HomeroomAssignmentDto = {
  id: string;
  schoolId: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  academicPeriodId: string;
  periodName: string;
};

export type CurriculumDto = {
  id: string;
  schoolId: string;
  academicYearId: string;
  academicYearName: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  reviewLabel?: "PERLU VERIFIKASI" | null;
  reviewNotes?: string[];
};

export type GradeReportPolicyStatus = "DRAFT" | "ACTIVE";
export type FormativeWeightMode = "COMBINED" | "SEPARATE";
export type RemedialScorePolicy = "HIGHEST" | "LATEST" | "CAPPED";
export type GradeRoundingMode = "NONE" | "INTEGER" | "ONE_DECIMAL" | "TWO_DECIMALS";

export type GradeReportPolicyInput = {
  academicYearId: string;
  academicPeriodId: string;
  curriculumId: string;
  label: string | null;
  useFormative: boolean;
  useSummative: boolean;
  useSts: boolean;
  useSas: boolean;
  formativeMode: FormativeWeightMode;
  weightFormative: number | null;
  weightUh: number | null;
  weightT1: number | null;
  weightT2: number | null;
  weightT3: number | null;
  weightSummative: number | null;
  weightSts: number | null;
  weightSas: number | null;
  remedialPolicy: RemedialScorePolicy;
  remedialCap: number | null;
  emptyTreatment: "INCOMPLETE";
  roundingMode: GradeRoundingMode;
};

export type GradeReportPolicyDto = GradeReportPolicyInput & {
  id: string;
  schoolId: string;
  status: GradeReportPolicyStatus;
  academicYearName: string;
  periodName: string;
  curriculumName: string;
  activatedAt: string | null;
};

export type GradeReportPolicyPreviewDto = {
  valid: boolean;
  messages: string[];
  summary: string[];
  total: number | null;
};

export type CurriculumPlacementDto = {
  id: string;
  schoolId: string;
  curriculumId: string;
  curriculumName: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
};

export type PlanItemDto = {
  id: string;
  schoolId: string;
  teachingAssignmentId: string;
  curriculumId: string | null;
  code: string;
  description: string;
  sequence: number;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  academicPeriodId: string;
  periodName: string;
};

export type LearningObjectiveDto = PlanItemDto;
export type MaterialScopeDto = PlanItemDto;

export type PlanSlotDto = {
  id: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  academicPeriodId: string;
  periodName: string;
  teacherName: string;
  writable: boolean;
};

export type OptionItem = {
  id: string;
  label: string;
};

export type ClassOptionItem = OptionItem & {
  concentrationId: string | null;
  academicYearActive: boolean;
};

export type AcademicOptionsDto = {
  years: OptionItem[];
  periods: OptionItem[];
  fields: OptionItem[];
  programs: OptionItem[];
  concentrations: OptionItem[];
  teachers: OptionItem[];
  classes: ClassOptionItem[];
  subjects: OptionItem[];
  members: OptionItem[];
  curricula: OptionItem[];
  planSlots: PlanSlotDto[];
};

export type ImportRowStatus =
  | "READY_CREATE"
  | "READY_UPDATE"
  | "NEEDS_REVIEW"
  | "DUPLICATE"
  | "REJECTED"
  | "SKIPPED"
  | "VALID"
  | "DUPLIKAT"
  | "GAGAL";

export type ImportPreviewRow = {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  valid: boolean;
  status?: ImportRowStatus;
  sheet?: string;
};

export type ImportSheetSummary = {
  name: string;
  role: "students" | "historical" | "skipped";
  reason: string;
  rowCount: number;
};

export type ImportClassCount = {
  className: string;
  count: number;
};

export type ImportClassMatch = {
  sheet: string;
  sourceName: string;
  status: "MATCHED" | "MISSING" | "AMBIGUOUS";
  classId: string | null;
  className: string | null;
  gradeLevel: number | null;
  studentCount: number;
};

export type ImportReasonCount = {
  status: string;
  reason: string;
  count: number;
};

export type ImportPreviewDto = {
  rows: ImportPreviewRow[];
  validCount: number;
  invalidCount: number;
  totalCount?: number;
  duplicateCount?: number;
  failedCount?: number;
  reviewCount?: number;
  skippedCount?: number;
  createCount?: number;
  updateCount?: number;
  unmappedColumns?: string[];
  sheets?: ImportSheetSummary[];
  classCounts?: ImportClassCount[];
  classMatches?: ImportClassMatch[];
  reasonCounts?: ImportReasonCount[];
  profilePersistence?: "available" | "unavailable";
};

export type ImportCommitDto = {
  created: number;
  updated?: number;
  skipped: number;
  rows: ImportPreviewRow[];
  totalCount?: number;
  duplicateCount?: number;
  failedCount?: number;
  reviewCount?: number;
  skippedCount?: number;
};

export type GradeStatus = "DRAFT";

export type AssessmentWorkflowStatus = "DRAFT" | "SUBMITTED" | "REVISION_REQUESTED";

export type GradeCompletenessComponent = {
  key: string;
  label: string;
  filled: number;
  total: number;
  required: boolean;
  note: string | null;
};

export type GradeCompletenessDto = {
  policyConfigured: boolean;
  warning: string | null;
  missingRequired: number;
  filled: number;
  total: number;
  components: GradeCompletenessComponent[];
};

export type GradeComponentKind = "FORMATIVE" | "SUMMATIVE" | "STS" | "SAS";

export type GradeComponentField = "uh" | "t1" | "t2" | "t3" | "remedial" | "score" | "sts" | "sas";

export type GradeLegacyLockDto = {
  status: "SUBMITTED" | "REVISION_REQUESTED";
  reason: string | null;
};

export type GradeComponentStatusDto = {
  key: string;
  kind: GradeComponentKind;
  field: GradeComponentField;
  learningObjectiveId: string | null;
  materialScopeId: string | null;
  label: string;
  status: AssessmentWorkflowStatus;
  locked: boolean;
  filled: number;
  total: number;
  required: boolean;
  missingRequired: number;
  submittedAt: string | null;
  revisionReason: string | null;
  recipientName: string | null;
};

export type GradeWorkflowItemDto = {
  assignmentId: string;
  className: string;
  subjectName: string;
  periodName: string;
  teacherName: string;
  recipientName: string | null;
  submissionHold: string | null;
  legacyLock: GradeLegacyLockDto | null;
  canResolveLegacy: boolean;
  components: Array<GradeComponentStatusDto & { canDecide: boolean }>;
};

export type GradeWorkflowListDto = {
  homeroomMissing: boolean;
  message: string | null;
  policyConfigured: boolean;
  warning: string | null;
  items: GradeWorkflowItemDto[];
};

export type GradeStudentDto = {
  id: string;
  name: string;
  nis: string | null;
};

export type FormativeGradeCell = {
  studentId: string;
  uh: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  remedial: number | null;
  status: GradeStatus;
};

export type FormativeGradeColumn = {
  learningObjectiveId: string;
  code: string;
  description: string;
  sequence: number;
  cells: FormativeGradeCell[];
};

export type SummativeGradeCell = {
  studentId: string;
  score: number | null;
  remedial: number | null;
  status: GradeStatus;
};

export type SummativeGradeColumn = {
  materialScopeId: string;
  code: string;
  description: string;
  sequence: number;
  cells: SummativeGradeCell[];
};

export type TermExamCell = {
  studentId: string;
  sts: number | null;
  sas: number | null;
  status: GradeStatus;
};

export type GradeSheetDto = {
  assignmentId: string;
  className: string;
  subjectName: string;
  periodName: string;
  teacherName: string;
  stsEnabled: boolean;
  sasEnabled: boolean;
  students: GradeStudentDto[];
  formative: FormativeGradeColumn[];
  summative: SummativeGradeColumn[];
  termExams: TermExamCell[];
  submissionHold: string | null;
  recipientName: string | null;
  legacyLock: GradeLegacyLockDto | null;
  components: GradeComponentStatusDto[];
  completeness: GradeCompletenessDto;
};

export type AuditLogDto = {
  id: string;
  schoolId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type PayrollPeriodStatus = "DRAFT" | "TERBIT" | "SELESAI";
export type PayrollSlipStatus = "DRAFT" | "DITERBITKAN" | "DIBAYAR";

export type PayrollPeriodDto = {
  id: string;
  schoolId: string;
  month: number;
  year: number;
  title: string;
  ratePerJtm: number;
  ratePerHadir: number;
  status: PayrollPeriodStatus;
  notes: string | null;
  slipCount?: number;
  totalNetPay?: number;
  createdAt: string;
  updatedAt: string;
};

export type PayrollSlipDto = {
  id: string;
  schoolId: string;
  periodId: string;
  userId: string;
  employeeName: string;
  roleLabel: string;
  totalHadirDays: number;
  totalJtmHours: number;
  baseHonor: number;
  attendanceBonus: number;
  positionBonus: number;
  deductionAmount: number;
  deductionNote: string | null;
  netPay: number;
  status: PayrollSlipStatus;
  approvedById: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  period?: {
    id: string;
    month: number;
    year: number;
    title: string;
    status: PayrollPeriodStatus;
  };
};

export type ToolCondition = "BAIK" | "PERLU_PERBAIKAN" | "RUSAK";
export type ToolLoanStatus = "DIPINJAM" | "DIKEMBALIKAN";
export type TracerStatus = "BEKERJA" | "WIRAUSAHA" | "KULIAH" | "BELUM_BEKERJA";

export type WorkshopToolDto = {
  id: string;
  schoolId: string;
  assetCode: string;
  name: string;
  labName: string;
  totalQty: number;
  availableQty: number;
  condition: ToolCondition;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolLoanDto = {
  id: string;
  schoolId: string;
  toolId: string;
  borrowerName: string;
  borrowerRole: string;
  qty: number;
  purpose: string | null;
  borrowedAt: string;
  returnedAt: string | null;
  status: ToolLoanStatus;
  tool?: {
    id: string;
    assetCode: string;
    name: string;
    labName: string;
  };
};

export type BkkJobPostDto = {
  id: string;
  schoolId: string;
  companyName: string;
  positionTitle: string;
  location: string;
  majorTarget: string | null;
  deadline: string | null;
  description: string;
  contactInfo: string | null;
  isActive: boolean;
  createdAt: string;
};

export type AlumniTracerDto = {
  id: string;
  schoolId: string;
  studentId: string | null;
  alumniName: string;
  graduationYear: number;
  majorName: string;
  status: TracerStatus;
  institutionName: string | null;
  positionOrStudy: string | null;
  phone: string | null;
  createdAt: string;
};

export type PpdbStatus = "MENDAFTAR" | "TERVERIFIKASI" | "DITERIMA" | "CADANGAN" | "DITOLAK";
export type WhistleblowerCategory = "PERUNDUNGAN_BULLYING" | "KEKERASAN_FISIK_VERBAL" | "FASILITAS_KEAMANAN" | "LAINNYA";
export type WhistleblowerStatus = "BARU" | "DITINDAKLANJUTI" | "SELESAI";

export type PpdbApplicantDto = {
  id: string;
  schoolId: string;
  registrationNo: string;
  fullName: string;
  nisn: string | null;
  originSchool: string;
  chosenMajor: string;
  parentPhone: string;
  averageScore: number | null;
  status: PpdbStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnonymousReportDto = {
  id: string;
  schoolId: string;
  ticketCode: string;
  category: WhistleblowerCategory;
  incidentPlace: string | null;
  description: string;
  status: WhistleblowerStatus;
  counselorReply: string | null;
  createdAt: string;
  updatedAt: string;
};
