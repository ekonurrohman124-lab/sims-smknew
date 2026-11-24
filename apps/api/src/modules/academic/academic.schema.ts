import { z } from "zod";

const blankToNull = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

function nullableString(schema: z.ZodType<string>): z.ZodType<string | null> {
  return z.preprocess(blankToNull, schema.nullable()) as z.ZodType<string | null>;
}

const optionalText = (max: number) => nullableString(z.string().max(max));

const optionalEmail = nullableString(z.string().email("Email tidak valid.").max(254));

const optionalNip = nullableString(z.string().regex(/^\d{8,18}$/, "NIP harus 8–18 digit."));

const optionalDigits = (max: number, message: string) =>
  nullableString(z.string().regex(new RegExp(`^\\d{1,${max}}$`), message));

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD.");

const codeText = z
  .string()
  .trim()
  .min(1, "Kode wajib diisi.")
  .max(16)
  .transform((value) => value.toUpperCase());

export const pageQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    page: z.preprocess((value) => (value === undefined || value === "" ? "1" : value), z.coerce.number().int().positive()),
    pageSize: z.preprocess(
      (value) => (value === undefined || value === "" ? "10" : value),
      z.enum(["10", "25", "50"]),
    ),
  })
  .transform((value) => ({
    q: value.q ? value.q : undefined,
    page: value.page,
    pageSize: Number(value.pageSize) as 10 | 25 | 50,
  })) as z.ZodType<{ q?: string; page: number; pageSize: 10 | 25 | 50 }>;

export const schoolWriteSchema = z.object({
  name: z.string().trim().min(3, "Nama sekolah minimal 3 karakter.").max(160),
  npsn: z.string().trim().regex(/^\d{8}$/, "NPSN harus 8 digit."),
  address: optionalText(300),
  city: optionalText(80),
  province: optionalText(80),
  postalCode: optionalText(10),
  phone: optionalText(32),
  email: optionalEmail,
  website: optionalText(200),
  accreditation: optionalText(8),
  principalName: optionalText(120),
  stsEnabled: z.boolean().optional(),
  sasEnabled: z.boolean().optional(),
  requireUh: z.boolean().optional(),
  requireT1: z.boolean().optional(),
  requireT2: z.boolean().optional(),
  requireT3: z.boolean().optional(),
  requireSummative: z.boolean().optional(),
  requireSts: z.boolean().optional(),
  requireSas: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const schoolAccessStatusSchema = z.object({
  status: z.enum(["AKTIF", "NONAKTIF", "DITANGGUHKAN"]),
  reason: z.string().trim().max(300, "Alasan maksimal 300 karakter.").optional(),
}).superRefine((value, context) => {
  if (value.status !== "AKTIF" && (value.reason ?? "").length < 8) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Alasan minimal 8 karakter." });
  }
});

export const yearSchema = z
  .object({
    name: z.string().trim().min(4).max(20),
    startDate: dateText,
    endDate: dateText,
    isActive: z.boolean(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
    path: ["endDate"],
  });

export const semesterSchema = z
  .object({
    academicYearId: z.string().trim().min(1),
    name: z.string().trim().min(3).max(40),
    semesterKind: z.enum(["GANJIL", "GENAP"]),
    startDate: dateText,
    endDate: dateText,
    isActive: z.boolean(),
    confirmUsedChange: z.boolean().optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
    path: ["endDate"],
  });

export const educationCalendarItemSchema = z.object({
  title: z.string().trim().min(3).max(180),
  category: z.enum(["KEGIATAN", "LIBUR", "ASESMEN", "RAPOR", "SEMESTER"]),
  semesterKind: z.enum(["GANJIL", "GENAP"]).nullable(),
  eventDate: dateText.nullable(),
  endDate: dateText.nullable(),
  verification: z.enum(["TERVERIFIKASI", "PERLU_VERIFIKASI"]),
});

export const educationCalendarNoteSchema = z.object({
  body: z.string().trim().min(8).max(500),
});

export const educationCalendarApplySchema = z.object({
  confirm: z.literal(true),
  creates: z.array(z.enum(["GANJIL", "GENAP"])).min(1).max(2),
});

export const fieldSchema = z.object({
  code: codeText,
  name: z.string().trim().min(3).max(120),
  isActive: z.boolean(),
});

export const programSchema = z.object({
  fieldId: z.string().trim().min(1),
  code: codeText,
  name: z.string().trim().min(3).max(160),
  isActive: z.boolean(),
});

export const concentrationSchema = z.object({
  programId: z.string().trim().min(1),
  code: codeText,
  name: z.string().trim().min(3).max(160),
  isActive: z.boolean(),
});

export const teacherSchema = z.object({
  nip: optionalNip,
  nuptk: optionalDigits(16, "NUPTK harus berupa angka."),
  name: z.string().trim().min(3).max(120),
  gender: z.enum(["LAKI_LAKI", "PEREMPUAN"]),
  email: optionalEmail,
  phone: optionalText(32),
  userId: nullableString(z.string().min(1)),
  isActive: z.boolean(),
});

const teacherAccountRole = z.enum(["GURU_MAPEL", "WALI_KELAS"]);

export const teacherWithAccountSchema = teacherSchema.omit({ userId: true, email: true }).extend({
  email: z.string().trim().email("Email tidak valid.").max(254).transform((value) => value.toLowerCase()),
  roles: z.array(teacherAccountRole).min(1, "Pilih minimal satu peran.").max(2),
  linkExisting: z.boolean().optional(),
});

export const teacherProfileSchema = teacherSchema.omit({ userId: true, email: true }).extend({
  email: z.string().trim().email("Email tidak valid.").max(254).transform((value) => value.toLowerCase()),
  roles: z.array(teacherAccountRole).min(1, "Pilih minimal satu peran.").max(2),
});

export const linkTeacherProfileSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(3).max(120),
  gender: z.enum(["LAKI_LAKI", "PEREMPUAN"]),
  nip: optionalNip,
  nuptk: optionalDigits(16, "NUPTK harus berupa angka."),
  phone: optionalText(32),
});

export const classSchema = z.object({
  academicYearId: z.string().trim().min(1),
  concentrationId: nullableString(z.string().min(1)),
  name: z.string().trim().min(1).max(40),
  gradeLevel: z.coerce.number().int().min(10).max(13),
  capacity: z.coerce.number().int().min(1).max(60),
  isActive: z.boolean(),
});

export const studentSchema = z.object({
  nisn: z.string().trim().regex(/^\d{10}$/, "NISN harus 10 digit."),
  nis: optionalText(32),
  name: z.string().trim().min(3).max(120),
  gender: z.enum(["LAKI_LAKI", "PEREMPUAN"]),
  birthPlace: optionalText(80),
  birthDate: nullableString(dateText),
  email: optionalEmail,
  phone: optionalText(32),
  classId: nullableString(z.string().min(1)),
  concentrationId: nullableString(z.string().min(1)),
  isActive: z.boolean(),
});

const optionalListId = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? undefined : value),
  z.string().trim().min(1).max(64).optional(),
) as z.ZodType<string | undefined>;

export const studentListQuerySchema = z.object({
  classId: optionalListId,
  concentrationId: optionalListId,
});

export const studentTransitionSchema = z
  .object({
    mode: z.enum(["PROMOTE", "GRADUATE"]),
    sourceClassId: z.string().trim().min(1).max(64),
    targetClassId: z.string().trim().min(1).max(64).optional(),
    graduationYear: z.coerce.number().int().min(2000).max(2100).optional(),
    studentIds: z.array(z.string().trim().min(1).max(64)).min(1, "Pilih minimal satu siswa.").max(1000),
  })
  .superRefine((value, context) => {
    if (value.mode === "PROMOTE") {
      if (!value.targetClassId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetClassId"], message: "Rombel tujuan wajib diisi." });
      } else if (value.targetClassId === value.sourceClassId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetClassId"], message: "Rombel tujuan harus berbeda dari kelas asal." });
      }
    }
    if (value.mode === "GRADUATE" && value.graduationYear === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["graduationYear"], message: "Tahun lulus wajib diisi." });
    }
  });

export const subjectSchema = z.object({
  code: codeText,
  name: z.string().trim().min(2).max(120),
  category: z.enum(["UMUM", "KEJURUAN"]),
  isActive: z.boolean(),
});

export const teachingSchema = z.object({
  teacherId: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  classId: z.string().trim().min(1),
  academicPeriodId: z.string().trim().min(1),
});

export const homeroomSchema = z.object({
  teacherId: z.string().trim().min(1),
  classId: z.string().trim().min(1),
  academicPeriodId: z.string().trim().min(1),
});

const curriculumCode = z
  .string()
  .trim()
  .min(1, "Kode wajib diisi.")
  .max(32)
  .transform((value) => value.toUpperCase());

const optionalPlanCode = z.preprocess(
  blankToNull,
  z.union([z.null(), curriculumCode]),
) as z.ZodType<string | null>;

const optionalSequence = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.number().int().min(1).max(9999)]),
) as z.ZodType<number | null>;

const optionalQueryId = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const curriculumSchema = z.object({
  academicYearId: z.string().trim().min(1),
  code: curriculumCode,
  name: z.string().trim().min(3).max(160),
  description: optionalText(500),
  isActive: z.boolean(),
});

export const placementSchema = z.object({
  curriculumId: z.string().trim().min(1),
  classId: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
});

export type PlanItemInput = {
  classId: string;
  subjectId: string;
  academicPeriodId: string;
  code: string | null;
  description: string;
  sequence: number | null;
};

export type PlanUpdateInput = {
  code: string;
  description: string;
  sequence: number;
};

export type PlanQuery = {
  q?: string;
  page: number;
  pageSize: 10 | 25 | 50;
  classId?: string;
  subjectId?: string;
  academicPeriodId?: string;
};

export const planItemSchema = z.object({
  classId: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  academicPeriodId: z.string().trim().min(1),
  code: optionalPlanCode,
  description: z.string().trim().min(3, "Deskripsi minimal 3 karakter.").max(1000),
  sequence: optionalSequence,
}) as z.ZodType<PlanItemInput>;

export const planUpdateSchema = z.object({
  code: curriculumCode,
  description: z.string().trim().min(3, "Deskripsi minimal 3 karakter.").max(1000),
  sequence: z.coerce.number().int().min(1).max(9999),
}) as z.ZodType<PlanUpdateInput>;

export const planQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    page: z.preprocess((value) => (value === undefined || value === "" ? "1" : value), z.coerce.number().int().positive()),
    pageSize: z.preprocess(
      (value) => (value === undefined || value === "" ? "10" : value),
      z.enum(["10", "25", "50"]),
    ),
    classId: optionalQueryId,
    subjectId: optionalQueryId,
    academicPeriodId: optionalQueryId,
  })
  .transform((value) => ({
    q: value.q ? value.q : undefined,
    page: value.page,
    pageSize: Number(value.pageSize) as 10 | 25 | 50,
    classId: value.classId,
    subjectId: value.subjectId,
    academicPeriodId: value.academicPeriodId,
  })) as z.ZodType<PlanQuery>;

const importCell = z.record(z.string(), z.string());

const importCommitRow = z.union([
  importCell,
  z.object({
    rowNumber: z.number().int().positive().max(100000),
    data: importCell,
  }),
]);

function isImportEnvelope(
  row: Record<string, string> | { rowNumber: number; data: Record<string, string> },
): row is { rowNumber: number; data: Record<string, string> } {
  return "rowNumber" in row && typeof row.rowNumber === "number" && "data" in row && typeof row.data === "object" && row.data !== null && !Array.isArray(row.data);
}

export const importCommitSchema = z
  .object({
    rows: z.array(importCommitRow).max(4000, "Impor dibatasi 4.000 baris."),
    academicYearId: z.preprocess(
      (value) => (value === undefined || value === null || value === "" ? undefined : value),
      z.string().trim().min(1).max(64).optional(),
    ),
  })
  .transform((value) => ({
    academicYearId: value.academicYearId,
    rows: value.rows.map((row, index) =>
      isImportEnvelope(row) ? { rowNumber: row.rowNumber, data: row.data } : { rowNumber: index + 2, data: row },
    ),
  })) as z.ZodType<{ academicYearId?: string; rows: { rowNumber: number; data: Record<string, string> }[] }>;

export const studentTemplateQuerySchema = z.object({
  format: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? undefined : value),
    z.enum(["csv", "xlsx"]).optional(),
  ),
  academicYearId: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? undefined : value),
    z.string().trim().min(1).max(64).optional(),
  ),
}) as z.ZodType<{ format?: "csv" | "xlsx"; academicYearId?: string }>;

export const idParamsSchema = z.object({
  schoolId: z.string().trim().min(1).max(64),
  id: z.string().trim().min(1).max(64),
});

export const educationCalendarItemParamsSchema = z.object({
  schoolId: z.string().trim().min(1).max(64),
  id: z.string().trim().min(1).max(64),
  itemId: z.string().trim().min(1).max(64),
});

export const schoolParamsSchema = z.object({
  schoolId: z.string().trim().min(1).max(64),
});

const scoreNumber = z
  .number({ invalid_type_error: "Nilai harus angka." })
  .min(0, "Nilai minimal 0.")
  .max(100, "Nilai maksimal 100.")
  .refine((value) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Nilai maksimal 2 desimal.");

const optionalScore = z.union([z.null(), scoreNumber]).optional();
const idText = z.string().trim().min(1).max(64);

export const gradeParamsSchema = z.object({
  schoolId: idText,
  assignmentId: idText,
});

export const gradeSaveSchema = z.object({
  formative: z
    .array(
      z
        .object({
          learningObjectiveId: idText,
          studentId: idText,
          uh: optionalScore,
          t1: optionalScore,
          t2: optionalScore,
          t3: optionalScore,
          remedial: optionalScore,
        })
        .refine((value) => [value.uh, value.t1, value.t2, value.t3, value.remedial].some((item) => item !== undefined), {
          message: "Tidak ada nilai formatif yang dikirim.",
        }),
    )
    .max(400)
    .optional(),
  summative: z
    .array(
      z
        .object({
          materialScopeId: idText,
          studentId: idText,
          score: optionalScore,
          remedial: optionalScore,
        })
        .refine((value) => value.score !== undefined || value.remedial !== undefined, {
          message: "Tidak ada nilai sumatif yang dikirim.",
        }),
    )
    .max(400)
    .optional(),
  termExams: z
    .array(
      z
        .object({
          studentId: idText,
          sts: optionalScore,
          sas: optionalScore,
        })
        .refine((value) => value.sts !== undefined || value.sas !== undefined, {
          message: "Tidak ada nilai STS atau SAS yang dikirim.",
        }),
    )
    .max(400)
    .optional(),
});

export type GradeSaveInput = z.infer<typeof gradeSaveSchema>;

const componentKeySchema = z.string().trim().min(3).max(120);

export const gradeSubmitSchema = z.object({
  componentKey: componentKeySchema,
});

export const gradeRevisionSchema = z.object({
  componentKey: componentKeySchema,
  reason: z.string().trim().min(10, "Alasan revisi minimal 10 karakter.").max(500),
});

export const gradeDecisionSchema = z.object({
  componentKey: componentKeySchema,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export const gradeLegacyResolveSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: "Konfirmasi penyelesaian status lama wajib diberikan." }) }),
  note: z.string().trim().min(10, "Catatan penyelesaian minimal 10 karakter.").max(500),
});

export const gradeWorkflowQuerySchema = z.object({
  view: z.enum(["guru", "wali", "staff"]),
});

function boundedNumber(label: string) {
  return z
    .number({ invalid_type_error: `${label} harus angka.` })
    .min(0, `${label} minimal 0.`)
    .max(100, `${label} maksimal 100.`)
    .refine((value) => Math.round(value * 100) === value * 100, `${label} maksimal dua angka di belakang koma.`)
    .nullable();
}

const policyWeight = boundedNumber("Bobot");
const remedialCapValue = boundedNumber("Batas maksimum");

export const gradeReportPolicySchema = z.object({
  academicYearId: z.string().trim().min(1).max(64),
  academicPeriodId: z.string().trim().min(1).max(64),
  curriculumId: z.string().trim().min(1).max(64),
  label: z.preprocess(
    (value) => (value === undefined || value === "" ? null : value),
    z.string().trim().max(40, "Penanda maksimal 40 karakter.").nullable(),
  ) as z.ZodType<string | null>,
  useFormative: z.boolean(),
  useSummative: z.boolean(),
  useSts: z.boolean(),
  useSas: z.boolean(),
  formativeMode: z.enum(["COMBINED", "SEPARATE"]),
  weightFormative: policyWeight,
  weightUh: policyWeight,
  weightT1: policyWeight,
  weightT2: policyWeight,
  weightT3: policyWeight,
  weightSummative: policyWeight,
  weightSts: policyWeight,
  weightSas: policyWeight,
  remedialPolicy: z.enum(["HIGHEST", "LATEST", "CAPPED"]),
  remedialCap: remedialCapValue,
  emptyTreatment: z.literal("INCOMPLETE", {
    errorMap: () => ({ message: "Nilai kosong harus diperlakukan sebagai belum lengkap, bukan nol." }),
  }),
  roundingMode: z.enum(["NONE", "INTEGER", "ONE_DECIMAL", "TWO_DECIMALS"]),
});

export type GradeReportPolicyInput = z.infer<typeof gradeReportPolicySchema>;

export const finalGradeQuerySchema = z.object({
  basis: z.enum(["preview", "official"]),
});

export const finalGradeListQuerySchema = z.object({
  view: z.enum(["guru", "wali"]),
});

export const homeroomRecapQuerySchema = z.object({
  homeroomId: z.string().trim().min(1).optional(),
});

export const finalGradeCommitSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: "Konfirmasi penyimpanan hasil resmi wajib diberikan." }) }),
});

export type GradeSubmitInput = z.infer<typeof gradeSubmitSchema>;
export type GradeRevisionInput = z.infer<typeof gradeRevisionSchema>;
export type GradeDecisionInput = z.infer<typeof gradeDecisionSchema>;
export type GradeLegacyResolveInput = z.infer<typeof gradeLegacyResolveSchema>;
