import { z } from "zod";

export const schoolParamsSchema = z.object({
  schoolId: z.string().min(1),
});

export const loanParamsSchema = z.object({
  schoolId: z.string().min(1),
  loanId: z.string().min(1),
});

export const createToolSchema = z.object({
  assetCode: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(160),
  labName: z.string().trim().min(2).max(120),
  totalQty: z.number().int().min(1).max(10000).default(1),
  condition: z.enum(["BAIK", "PERLU_PERBAIKAN", "RUSAK"]).default("BAIK"),
  notes: z.string().trim().max(300).optional(),
});

export const createToolLoanSchema = z.object({
  toolId: z.string().min(1),
  borrowerName: z.string().trim().min(2).max(160),
  borrowerRole: z.string().trim().min(2).max(80),
  qty: z.number().int().min(1).max(500).default(1),
  purpose: z.string().trim().max(300).optional(),
});

export const createBkkJobSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  positionTitle: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(120),
  majorTarget: z.string().trim().max(120).optional(),
  deadline: z.string().trim().optional(),
  description: z.string().trim().min(5).max(2000),
  contactInfo: z.string().trim().max(200).optional(),
});

export const createAlumniTracerSchema = z.object({
  studentId: z.string().trim().min(1).optional(),
  alumniName: z.string().trim().min(2).max(160),
  graduationYear: z.number().int().min(2000).max(2100),
  majorName: z.string().trim().min(2).max(120),
  status: z.enum(["BEKERJA", "WIRAUSAHA", "KULIAH", "BELUM_BEKERJA"]),
  institutionName: z.string().trim().max(160).optional(),
  positionOrStudy: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(32).optional(),
});
