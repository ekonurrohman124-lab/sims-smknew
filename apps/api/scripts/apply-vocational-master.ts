import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { applyVocationalMaster } from "../src/modules/academic/vocational-master.service.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const TARGET_NPSN = "10814092";
const BANNED_DATABASES = new Set(["sims_sakti_qc", "sims_smk", "sims_smk_test"]);

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

function argument(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found?.slice(prefix.length).trim() ?? "";
}

async function main(): Promise<void> {
  const sourceUrl = process.env.DATABASE_URL;
  const npsn = argument("npsn");
  if (!sourceUrl || !npsn) throw new Error("Perintah membutuhkan DATABASE_URL dan --npsn.");
  if (npsn !== TARGET_NPSN) throw new Error("Master kejuruan hanya untuk NPSN 10814092.");
  const name = databaseName(sourceUrl);
  if (BANNED_DATABASES.has(name)) throw new Error("Master kejuruan tidak dijalankan pada database aktif.");
  const prisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (rows[0]?.name !== name || BANNED_DATABASES.has(rows[0]?.name ?? "")) {
      throw new Error("Database sasaran tidak sesuai.");
    }
    const school = await prisma.school.findFirst({ where: { npsn }, select: { id: true } });
    if (!school) throw new Error("Sekolah tidak ditemukan. Sekolah baru tidak dibuat.");
    const year = await prisma.academicYear.findFirst({
      where: { schoolId: school.id, name: "2026/2027" },
      select: { id: true },
    });
    if (!year) throw new Error("Tahun pelajaran 2026/2027 tidak ditemukan. Tahun pelajaran tidak dibuat.");
    const result = await applyVocationalMaster(prisma, school.id, year.id);
    console.log(JSON.stringify({
      fieldsCreated: result.fieldsCreated,
      programsCreated: result.programsCreated,
      concentrationsCreated: result.concentrationsCreated,
      subjectsCreated: result.subjectsCreated,
      curriculaCreated: result.curriculaCreated,
      placementsCreated: result.placementsCreated,
      conflicts: result.conflicts.length,
      confirmations: result.confirmations.length,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Master kejuruan gagal.");
  process.exitCode = 1;
});
