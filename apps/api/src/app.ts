import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { Prisma, type PrismaClient } from "@prisma/client";
import Fastify, { type FastifyError } from "fastify";
import { config } from "./config.ts";
import { isAppError } from "./lib/errors.ts";
import { isAllowedWebOrigin, lanFrontendUrls } from "./lib/lan.ts";
import { MSG } from "./lib/messages.ts";
import type { AuthState } from "./lib/auth-state.ts";
import { academicRoutes } from "./modules/academic/academic.routes.ts";
import { schoolUserRoutes } from "./modules/access/school-users.routes.ts";
import { authRoutes } from "./modules/auth/auth.routes.ts";
import { hrAttendanceRoutes } from "./modules/hr-attendance/hr-attendance.routes.ts";
import { characterCounselingRoutes } from "./modules/character-counseling/character-counseling.routes.ts";
import { journalRoutes } from "./modules/journal/journal.routes.ts";
import { financeRoutes } from "./modules/finance/finance.routes.ts";
import { internshipRoutes } from "./modules/internship/internship.routes.ts";
import { payrollRoutes } from "./modules/payroll/payroll.routes.ts";
import { vokasiRoutes } from "./modules/vokasi/vokasi.routes.ts";
import { publicPortalRoutes } from "./modules/public-portal/public-portal.routes.ts";
import { leaveRoutes } from "./modules/leave/leave.routes.ts";
import { schoolRoutes } from "./modules/schools/school.routes.ts";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export type BuildAppOptions = {
  prisma: PrismaClient;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger:
      config.nodeEnv === "development"
        ? {
            level: "info",
            redact: ["req.headers.authorization", "req.headers.cookie"],
          }
        : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });

  app.decorate("prisma", options.prisma);

  app.addHook("onRequest", async (request, reply) => {
    request.auth = null;
    reply.header("cache-control", "no-store");
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, isAllowedWebOrigin(origin, { webOrigin: config.webOrigin, nodeEnv: config.nodeEnv }));
    },
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  });
  await app.register(rateLimit, {
    global: false,
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." },
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode === 413) {
      return reply.status(413).send({
        error: { code: "FILE_TOO_LARGE", message: "Berkas terlalu besar. Maksimal 2 MB." },
      });
    }

    if (statusCode === 429) {
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: MSG.rateLimited },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
      request.log.error({ code: error.code }, "struktur tabel belum sesuai dengan klien aplikasi");
      return reply.status(500).send({
        error: {
          code: "SCHEMA_MISMATCH",
          message: "Struktur data belum sesuai dengan aplikasi. Data tidak diubah. Pembaruan database perlu disetujui terlebih dahulu.",
        },
      });
    }

    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: "BAD_REQUEST", message: "Permintaan tidak valid." },
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: MSG.internal },
    });
  });

  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/lan-access", async () => {
    if (config.nodeEnv !== "development") {
      return { frontendUrls: [] as string[], localFrontendUrl: null, apiPort: config.apiPort };
    }
    return {
      frontendUrls: lanFrontendUrls(),
      localFrontendUrl: config.webOrigin,
      apiPort: config.apiPort,
    };
  });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(schoolRoutes, { prefix: "/api/v1" });
  await app.register(academicRoutes, { prefix: "/api/v1" });
  await app.register(schoolUserRoutes, { prefix: "/api/v1" });
  await app.register(hrAttendanceRoutes, { prefix: "/api/v1" });
  await app.register(journalRoutes, { prefix: "/api/v1" });
  await app.register(leaveRoutes, { prefix: "/api/v1" });
  await app.register(characterCounselingRoutes, { prefix: "/api/v1" });
  await app.register(financeRoutes, { prefix: "/api/v1" });
  await app.register(internshipRoutes, { prefix: "/api/v1" });
  await app.register(payrollRoutes, { prefix: "/api/v1" });
  await app.register(vokasiRoutes, { prefix: "/api/v1" });
  await app.register(publicPortalRoutes, { prefix: "/api/v1" });

  return app;
}
