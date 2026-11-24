import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../lib/errors.ts";
import { requestMeta } from "../../lib/tenant.ts";
import { parseInput } from "../../lib/validation.ts";
import { getAuth, requireAuth } from "../auth/auth.routes.ts";
import {
  classSchema,
  concentrationSchema,
  fieldSchema,
  curriculumSchema,
  gradeDecisionSchema,
  gradeLegacyResolveSchema,
  gradeParamsSchema,
  gradeRevisionSchema,
  gradeSubmitSchema,
  gradeSaveSchema,
  finalGradeCommitSchema,
  finalGradeListQuerySchema,
  finalGradeQuerySchema,
  homeroomRecapQuerySchema,
  gradeReportPolicySchema,
  gradeWorkflowQuerySchema,
  homeroomSchema,
  idParamsSchema,
  educationCalendarItemParamsSchema,
  importCommitSchema,
  studentTemplateQuerySchema,
  pageQuerySchema,
  placementSchema,
  planItemSchema,
  planQuerySchema,
  planUpdateSchema,
  programSchema,
  schoolParamsSchema,
  semesterSchema,
  educationCalendarApplySchema,
  educationCalendarItemSchema,
  educationCalendarNoteSchema,
  studentListQuerySchema,
  studentSchema,
  studentTransitionSchema,
  subjectSchema,
  linkTeacherProfileSchema,
  teacherProfileSchema,
  teacherSchema,
  teacherWithAccountSchema,
  teachingSchema,
  yearSchema,
} from "./academic.schema.ts";
import { createHomeroom, deleteHomeroom, deleteTeaching, listHomerooms, listTeachings, createTeaching } from "./assignment.service.ts";
import { schoolDashboard, type SchoolDashboardView } from "./dashboard.service.ts";
import {
  activateGradePolicy,
  createGradePolicy,
  deleteGradePolicy,
  listGradePolicies,
  previewGradePolicy,
  updateGradePolicy,
} from "./grade-policy.service.ts";
import { attendanceCompletenessSaveSchema, attendanceCorrectSchema, attendanceCreateSchema, attendanceDraftSchema, attendanceListSchema, attendanceMeetingParamsSchema, attendanceRecapQuerySchema, dailyAttendanceCorrectSchema, dailyAttendanceDraftSchema, dailyAttendanceQuerySchema } from "./attendance.schema.ts";
import { correctAttendanceMeeting, createAttendanceMeeting, finalizeAttendanceMeeting, getAttendanceBoard, getAttendanceMeeting, saveAttendanceDraft } from "./attendance.service.ts";
import { commitFinalGrades, getFinalGradeSheet, getHomeroomGradeMonitor, getHomeroomGradeRecap, listFinalGrades } from "./grade-final.service.ts";
import { getHomeroomAttendanceRecap } from "./attendance-recap.service.ts";
import { activateAttendanceCompleteness, getAttendanceCompleteness, saveAttendanceCompleteness } from "./attendance-completeness.service.ts";
import { correctDailyAttendance, finalizeDailyAttendance, getDailyAttendance, saveDailyAttendance } from "./daily-attendance.service.ts";
import { getHomeroomReportPrep } from "./report-card/report-card.service.ts";
import { getHomeroomReportPreview } from "./report-card/preview.service.ts";
import { reportDecisionSchema, reportDossierQuerySchema, reportExaminationQuerySchema, reportPrintQuerySchema, reportQueueQuerySchema, reportReviewSchema, reportRevisionSchema } from "./report-workflow.schema.ts";
import { readOfficialReportPdf, readOfficialReportPrint } from "./report-card/print.service.ts";
import { decideReportEndorsement, decideReportValidation, getReportDossier, getReportExaminations, getReportQueue, openReportRevision, reviewReportCard, submitReportCard } from "./report-workflow.service.ts";
import {
  createClass,
  createConcentration,
  createField,
  createProgram,
  createSemester,
  createSubject,
  createYear,
  deleteClass,
  deleteConcentration,
  deleteField,
  deleteProgram,
  deleteSemester,
  deleteSubject,
  deleteYear,
  listClasses,
  listConcentrations,
  listFields,
  listPrograms,
  listSemesters,
  listSubjects,
  listYears,
  updateClass,
  updateConcentration,
  updateField,
  updateProgram,
  updateSemester,
  updateSubject,
  updateYear,
} from "./catalog.service.ts";
import { STUDENT_TEMPLATE, TEACHER_TEMPLATE, buildStudentTemplate, commitImport, previewImport } from "./import.service.ts";
import { academicOptions } from "./options.service.ts";
import { createStudent, createTeacher, deleteStudent, deleteTeacher, listStudents, listTeachers, transitionStudents, updateStudent, updateTeacher } from "./people.service.ts";
import { createTeacherWithAccount, linkTeacherProfile, provisionTeacherAccount, resetTeacherPassword, reviseTeacherProfile, unlinkTeacherAccount } from "./teacher-account.service.ts";
import { OBJECTIVE_TEMPLATE, SCOPE_TEMPLATE, commitPlanImport, previewPlanImport } from "./plan-import.service.ts";
import {
  createCurriculum,
  createPlacement,
  createPlanItem,
  deleteCurriculum,
  deletePlacement,
  deletePlanItem,
  listCurricula,
  listPlacements,
  listPlanItems,
  updateCurriculum,
  updatePlanItem,
} from "./plan.service.ts";
import { competencyDescriptionDecisionSchema, competencyDescriptionQuerySchema, competencyDescriptionRevisionSchema, competencyDescriptionSaveSchema, competencyDescriptionSubmitSchema, homeroomDescriptionQuerySchema } from "./competency-description.schema.ts";
import { decideCompetencyDescriptionRevision, getCompetencyDescriptions, getHomeroomCompetencyDescriptions, requestCompetencyDescriptionRevision, saveCompetencyDescriptionDraft, submitCompetencyDescription } from "./competency-description.service.ts";
import { homeroomNoteCorrectSchema, homeroomNoteQuerySchema, homeroomNoteSaveSchema } from "./homeroom-note.schema.ts";
import { correctHomeroomNote, finalizeHomeroomNote, getHomeroomNotes, saveHomeroomNoteDraft } from "./homeroom-note.service.ts";
import { decideGradeRevision, getGradeSheet, listGradeWorkflows, requestGradeRevision, resolveLegacyGradeSubmission, saveGrades, submitGrades } from "./grade.service.ts";
import { previewKaldik } from "./kaldik-lampung.ts";
import {
  addEducationCalendarNote,
  applyEducationCalendar,
  correctEducationCalendarItem,
  educationCalendarDetail,
  educationCalendarFile,
  listEducationCalendar,
  publishEducationCalendar,
  uploadEducationCalendar,
} from "./education-calendar.service.ts";
import { assertCanCoordinate, assertCanManage, loadPlanAccess, loadScope } from "./scope.ts";

function context(request: FastifyRequest) {
  return {
    auth: getAuth(request),
    meta: requestMeta(request),
    params: parseInput(schoolParamsSchema, request.params),
  };
}

async function readScope(app: FastifyInstance, request: FastifyRequest) {
  const current = context(request);
  const scope = await loadScope(app.prisma, current.auth, current.params.schoolId, current.meta);
  const query = parseInput(pageQuerySchema, request.query);
  return { ...current, scope, query };
}

async function manage(app: FastifyInstance, request: FastifyRequest) {
  const current = context(request);
  await assertCanManage(app.prisma, current.auth, current.params.schoolId, current.meta);
  return current;
}

async function coordinate(app: FastifyInstance, request: FastifyRequest) {
  const current = context(request);
  await assertCanCoordinate(app.prisma, current.auth, current.params.schoolId, current.meta);
  return current;
}

async function planContext(app: FastifyInstance, request: FastifyRequest) {
  const current = context(request);
  const access = await loadPlanAccess(app.prisma, current.auth, current.params.schoolId, current.meta);
  const query = parseInput(planQuerySchema, request.query);
  return { ...current, access, query };
}

async function planWriter(app: FastifyInstance, request: FastifyRequest) {
  const current = await planContext(app, request);
  if (!current.access.writeAll && !current.access.teacherId) {
    throw new AppError(403, "FORBIDDEN", "Akun guru belum tertaut ke data guru.");
  }
  return current;
}

function csv(reply: FastifyReply, filename: string, body: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${filename}"`)
    .send(body);
}

const DASHBOARD_VIEWS = new Set<SchoolDashboardView>(["admin", "kepala", "wakakur", "guru", "wali"]);

export async function academicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/schools/:schoolId/dashboard", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const view = (request.query as { view?: string }).view;
    if (!view || !DASHBOARD_VIEWS.has(view as SchoolDashboardView)) {
      throw new AppError(400, "VALIDATION", "Tampilan dasbor tidak dikenal.");
    }
    return schoolDashboard(app.prisma, current.auth, current.params.schoolId, view as SchoolDashboardView, current.meta);
  });

  app.get("/schools/:schoolId/academic-options", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const scope = await loadScope(app.prisma, current.auth, current.params.schoolId, current.meta);
    const canManage =
      current.auth.isSystemOwner ||
      current.auth.assignments.some(
        (assignment) => assignment.schoolId === current.params.schoolId && assignment.roleCode === "ADMIN_SEKOLAH",
      );
    const canCoordinate =
      canManage ||
      current.auth.assignments.some(
        (assignment) => assignment.schoolId === current.params.schoolId && assignment.roleCode === "WAKAKUR",
      );
    return {
      options: await academicOptions(app.prisma, current.params.schoolId, scope, canManage, canCoordinate),
    };
  });

  app.get("/schools/:schoolId/academic-years", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listYears(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/academic-years", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const body = parseInput(yearSchema, request.body ?? {});
    const item = await createYear(app.prisma, current.auth, current.params.schoolId, body, current.meta);
    return reply.status(201).send({ item });
  });
  app.patch("/schools/:schoolId/academic-years/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    const body = parseInput(yearSchema, request.body ?? {});
    return { item: await updateYear(app.prisma, current.auth, params.schoolId, params.id, body, current.meta) };
  });
  app.delete("/schools/:schoolId/academic-years/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteYear(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/kaldik-preview", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return { preview: await previewKaldik(app.prisma, current.params.schoolId) };
  });

  app.get("/schools/:schoolId/education-calendar", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listEducationCalendar(app.prisma, current.auth, current.params.schoolId);
  });
  app.get("/schools/:schoolId/education-calendar/:id", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return educationCalendarDetail(app.prisma, current.auth, params.schoolId, params.id);
  });
  app.get("/schools/:schoolId/education-calendar/:id/file", { preHandler: requireAuth }, async (request, reply) => {
    const current = await readScope(app, request);
    const params = parseInput(idParamsSchema, request.params);
    const file = await educationCalendarFile(current.auth, params.schoolId, params.id);
    return reply.header("Content-Type", file.document.mimeType).header("Content-Disposition", "attachment").send(file.content);
  });
  app.post("/schools/:schoolId/education-calendar", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    let academicYearId = "";
    let filename = "";
    let mimetype = "";
    let content: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        filename = part.filename;
        mimetype = part.mimetype;
        content = await part.toBuffer();
      } else if (part.fieldname === "academicYearId") {
        academicYearId = String(part.value ?? "");
      }
    }
    if (!content) throw new AppError(400, "VALIDATION_ERROR", "Berkas wajib diunggah.");
    const result = await uploadEducationCalendar(app.prisma, current.auth, current.params.schoolId, academicYearId, { filename, mimetype, content });
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });
  app.patch("/schools/:schoolId/education-calendar/:id/items/:itemId", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(educationCalendarItemParamsSchema, request.params);
    return correctEducationCalendarItem(current.auth, params.schoolId, params.id, params.itemId, parseInput(educationCalendarItemSchema, request.body ?? {}));
  });
  app.post("/schools/:schoolId/education-calendar/:id/notes", { preHandler: requireAuth }, async (request, reply) => {
    const current = await readScope(app, request);
    const params = parseInput(idParamsSchema, request.params);
    const body = parseInput(educationCalendarNoteSchema, request.body ?? {});
    const author = await app.prisma.user.findFirst({ where: { id: current.auth.userId }, select: { name: true } });
    return reply.status(201).send(await addEducationCalendarNote(current.auth, params.schoolId, params.id, body.body, author?.name ?? "Pengguna"));
  });
  app.post("/schools/:schoolId/education-calendar/:id/publish", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return publishEducationCalendar(current.auth, params.schoolId, params.id);
  });
  app.post("/schools/:schoolId/education-calendar/:id/apply", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    const body = parseInput(educationCalendarApplySchema, request.body ?? {});
    return applyEducationCalendar(app.prisma, current.auth, params.schoolId, params.id, body.creates, current.meta);
  });

  app.get("/schools/:schoolId/semesters", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listSemesters(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/semesters", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const body = parseInput(semesterSchema, request.body ?? {});
    return reply.status(201).send({ item: await createSemester(app.prisma, current.auth, current.params.schoolId, body, current.meta) });
  });
  app.patch("/schools/:schoolId/semesters/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateSemester(app.prisma, current.auth, params.schoolId, params.id, parseInput(semesterSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/semesters/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteSemester(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/expertise-fields", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listFields(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/expertise-fields", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createField(app.prisma, current.auth, current.params.schoolId, parseInput(fieldSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/expertise-fields/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateField(app.prisma, current.auth, params.schoolId, params.id, parseInput(fieldSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/expertise-fields/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteField(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/expertise-programs", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listPrograms(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/expertise-programs", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createProgram(app.prisma, current.auth, current.params.schoolId, parseInput(programSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/expertise-programs/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateProgram(app.prisma, current.auth, params.schoolId, params.id, parseInput(programSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/expertise-programs/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteProgram(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/expertise-concentrations", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listConcentrations(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/expertise-concentrations", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createConcentration(app.prisma, current.auth, current.params.schoolId, parseInput(concentrationSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/expertise-concentrations/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateConcentration(app.prisma, current.auth, params.schoolId, params.id, parseInput(concentrationSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/expertise-concentrations/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteConcentration(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/teachers", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listTeachers(app.prisma, current.params.schoolId, current.scope, current.query);
  });
  app.post("/schools/:schoolId/teachers", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createTeacher(app.prisma, current.auth, current.params.schoolId, parseInput(teacherSchema, request.body ?? {}), current.meta) });
  });
  app.post("/schools/:schoolId/teachers/with-account", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const result = await createTeacherWithAccount(app.prisma, current.auth, current.params.schoolId, parseInput(teacherWithAccountSchema, request.body ?? {}), current.meta);
    return reply.status(result.created ? 201 : 200).send(result);
  });
  app.post("/schools/:schoolId/teachers/link-profile", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const result = await linkTeacherProfile(app.prisma, current.auth, current.params.schoolId, parseInput(linkTeacherProfileSchema, request.body ?? {}), current.meta);
    return reply.status(result.created ? 201 : 200).send(result);
  });
  app.patch("/schools/:schoolId/teachers/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateTeacher(app.prisma, current.auth, params.schoolId, params.id, parseInput(teacherSchema, request.body ?? {}), current.meta) };
  });
  app.patch("/schools/:schoolId/teachers/:id/profile", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return reviseTeacherProfile(app.prisma, current.auth, params.schoolId, params.id, parseInput(teacherProfileSchema, request.body ?? {}), current.meta);
  });
  app.delete("/schools/:schoolId/teachers/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteTeacher(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });
  app.post("/schools/:schoolId/teachers/:id/account", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    const result = await provisionTeacherAccount(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(result.created ? 201 : 200).send(result);
  });
  app.post("/schools/:schoolId/teachers/:id/unlink-account", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return unlinkTeacherAccount(app.prisma, current.auth, params.schoolId, params.id, current.meta);
  });
  app.post("/schools/:schoolId/teachers/:id/reset-password", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return resetTeacherPassword(app.prisma, current.auth, params.schoolId, params.id, current.meta);
  });

  app.get("/schools/:schoolId/students", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    const filters = parseInput(studentListQuerySchema, request.query);
    return listStudents(app.prisma, current.params.schoolId, current.scope, { ...current.query, ...filters });
  });
  app.post("/schools/:schoolId/student-transitions", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    return transitionStudents(
      app.prisma,
      current.auth,
      current.params.schoolId,
      parseInput(studentTransitionSchema, request.body ?? {}),
      current.meta,
    );
  });
  app.post("/schools/:schoolId/students", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createStudent(app.prisma, current.auth, current.params.schoolId, parseInput(studentSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/students/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateStudent(app.prisma, current.auth, params.schoolId, params.id, parseInput(studentSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/students/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteStudent(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/classes", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listClasses(app.prisma, current.params.schoolId, current.scope, current.query);
  });
  app.post("/schools/:schoolId/classes", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    return reply.status(201).send({ item: await createClass(app.prisma, current.auth, current.params.schoolId, parseInput(classSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/classes/:id", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateClass(app.prisma, current.auth, params.schoolId, params.id, parseInput(classSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/classes/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteClass(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/subjects", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listSubjects(app.prisma, current.params.schoolId, current.scope, current.query);
  });
  app.post("/schools/:schoolId/subjects", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({ item: await createSubject(app.prisma, current.auth, current.params.schoolId, parseInput(subjectSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/subjects/:id", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateSubject(app.prisma, current.auth, params.schoolId, params.id, parseInput(subjectSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/subjects/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteSubject(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/teaching-assignments", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listTeachings(app.prisma, current.params.schoolId, current.scope, current.query);
  });
  app.post("/schools/:schoolId/teaching-assignments", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({ item: await createTeaching(app.prisma, current.auth, current.params.schoolId, parseInput(teachingSchema, request.body ?? {}), current.meta) });
  });
  app.delete("/schools/:schoolId/teaching-assignments/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteTeaching(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/homeroom-assignments", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listHomerooms(app.prisma, current.params.schoolId, current.scope, current.query);
  });
  app.post("/schools/:schoolId/homeroom-assignments", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({ item: await createHomeroom(app.prisma, current.auth, current.params.schoolId, parseInput(homeroomSchema, request.body ?? {}), current.meta) });
  });
  app.delete("/schools/:schoolId/homeroom-assignments/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteHomeroom(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/imports/teachers/template", { preHandler: requireAuth }, async (request, reply) => {
    await manage(app, request);
    return csv(reply, "templat-guru.csv", TEACHER_TEMPLATE);
  });
  app.get("/schools/:schoolId/imports/students/template", { preHandler: requireAuth }, async (request, reply) => {
    const current = await manage(app, request);
    const query = parseInput(studentTemplateQuerySchema, request.query);
    if (query.format === "xlsx") {
      const file = await buildStudentTemplate(app.prisma, current.params.schoolId, query.academicYearId ?? null);
      return reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", 'attachment; filename="templat-siswa.xlsx"')
        .send(file);
    }
    return csv(reply, "templat-siswa.csv", STUDENT_TEMPLATE);
  });

  async function readUpload(request: FastifyRequest): Promise<{ filename: string; buffer: Buffer; academicYearId: string | null }> {
    if (!request.isMultipart()) throw new AppError(400, "VALIDATION_ERROR", "Berkas wajib diunggah.");
    let filename = "";
    let buffer: Buffer | null = null;
    let academicYearId: string | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (buffer) {
          part.file.resume();
          continue;
        }
        filename = part.filename;
        buffer = await part.toBuffer();
      } else if (part.fieldname === "academicYearId") {
        const value = String(part.value ?? "").trim();
        academicYearId = value || null;
      }
    }
    if (!buffer || !filename) throw new AppError(400, "VALIDATION_ERROR", "Berkas wajib diunggah.");
    return { filename, buffer, academicYearId };
  }

  async function preview(request: FastifyRequest, kind: "teacher" | "student") {
    const current = await manage(app, request);
    const file = await readUpload(request);
    return previewImport(
      app.prisma,
      current.params.schoolId,
      kind,
      file.filename,
      file.buffer,
      kind === "student" ? file.academicYearId : null,
    );
  }

  app.post("/schools/:schoolId/imports/teachers/preview", { preHandler: requireAuth }, async (request) => preview(request, "teacher"));
  app.post("/schools/:schoolId/imports/students/preview", { preHandler: requireAuth }, async (request) => preview(request, "student"));
  app.post("/schools/:schoolId/imports/teachers/commit", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const body = parseInput(importCommitSchema, request.body ?? {});
    return commitImport(app.prisma, current.auth, current.params.schoolId, "teacher", body.rows, current.meta, null);
  });
  app.post("/schools/:schoolId/imports/students/commit", { preHandler: requireAuth }, async (request) => {
    const current = await manage(app, request);
    const body = parseInput(importCommitSchema, request.body ?? {});
    return commitImport(app.prisma, current.auth, current.params.schoolId, "student", body.rows, current.meta, body.academicYearId ?? null);
  });

  app.get("/schools/:schoolId/grade-report-policies", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    return listGradePolicies(app.prisma, current.params.schoolId, parseInput(pageQuerySchema, request.query));
  });
  app.post("/schools/:schoolId/grade-report-policies/preview", { preHandler: requireAuth }, async (request) => {
    await coordinate(app, request);
    return { preview: previewGradePolicy(parseInput(gradeReportPolicySchema, request.body ?? {})) };
  });
  app.post("/schools/:schoolId/grade-report-policies", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({
      item: await createGradePolicy(
        app.prisma,
        current.auth,
        current.params.schoolId,
        parseInput(gradeReportPolicySchema, request.body ?? {}),
        current.meta,
      ),
    });
  });
  app.patch("/schools/:schoolId/grade-report-policies/:id", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return {
      item: await updateGradePolicy(
        app.prisma,
        current.auth,
        params.schoolId,
        params.id,
        parseInput(gradeReportPolicySchema, request.body ?? {}),
        current.meta,
      ),
    };
  });
  app.post("/schools/:schoolId/grade-report-policies/:id/activate", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await activateGradePolicy(app.prisma, current.auth, params.schoolId, params.id, current.meta) };
  });
  app.delete("/schools/:schoolId/grade-report-policies/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteGradePolicy(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/curricula", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listCurricula(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/curricula", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({ item: await createCurriculum(app.prisma, current.auth, current.params.schoolId, parseInput(curriculumSchema, request.body ?? {}), current.meta) });
  });
  app.patch("/schools/:schoolId/curricula/:id", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    return { item: await updateCurriculum(app.prisma, current.auth, params.schoolId, params.id, parseInput(curriculumSchema, request.body ?? {}), current.meta) };
  });
  app.delete("/schools/:schoolId/curricula/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deleteCurriculum(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  app.get("/schools/:schoolId/curriculum-placements", { preHandler: requireAuth }, async (request) => {
    const current = await readScope(app, request);
    return listPlacements(app.prisma, current.params.schoolId, current.query);
  });
  app.post("/schools/:schoolId/curriculum-placements", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    return reply.status(201).send({ item: await createPlacement(app.prisma, current.auth, current.params.schoolId, parseInput(placementSchema, request.body ?? {}), current.meta) });
  });
  app.delete("/schools/:schoolId/curriculum-placements/:id", { preHandler: requireAuth }, async (request, reply) => {
    const current = await coordinate(app, request);
    const params = parseInput(idParamsSchema, request.params);
    await deletePlacement(app.prisma, current.auth, params.schoolId, params.id, current.meta);
    return reply.status(204).send();
  });

  function registerPlan(kind: "objective" | "scope", path: "learning-objectives" | "material-scopes") {
    app.get(`/schools/:schoolId/${path}`, { preHandler: requireAuth }, async (request) => {
      const current = await planContext(app, request);
      return listPlanItems(app.prisma, current.params.schoolId, current.access, current.query, kind);
    });
    app.post(`/schools/:schoolId/${path}`, { preHandler: requireAuth }, async (request, reply) => {
      const current = await planWriter(app, request);
      const item = await createPlanItem(
        app.prisma,
        current.auth,
        current.params.schoolId,
        current.access,
        parseInput(planItemSchema, request.body ?? {}),
        current.meta,
        kind,
      );
      return reply.status(201).send({ item });
    });
    app.patch(`/schools/:schoolId/${path}/:id`, { preHandler: requireAuth }, async (request) => {
      const current = await planWriter(app, request);
      const params = parseInput(idParamsSchema, request.params);
      return {
        item: await updatePlanItem(
          app.prisma,
          current.auth,
          params.schoolId,
          current.access,
          params.id,
          parseInput(planUpdateSchema, request.body ?? {}),
          current.meta,
          kind,
        ),
      };
    });
    app.delete(`/schools/:schoolId/${path}/:id`, { preHandler: requireAuth }, async (request, reply) => {
      const current = await planWriter(app, request);
      const params = parseInput(idParamsSchema, request.params);
      await deletePlanItem(app.prisma, current.auth, params.schoolId, current.access, params.id, current.meta, kind);
      return reply.status(204).send();
    });
  }

  registerPlan("objective", "learning-objectives");
  registerPlan("scope", "material-scopes");

  async function importPlan(request: FastifyRequest, kind: "objective" | "scope") {
    const current = context(request);
    const access = await loadPlanAccess(app.prisma, current.auth, current.params.schoolId, current.meta);
    if (!access.writeAll && !access.teacherId) {
      throw new AppError(403, "FORBIDDEN", access.teacherId === null && !access.readAll ? "Akun guru belum tertaut ke data guru." : "Anda tidak memiliki izin untuk aksi ini.");
    }
    if (!access.writeAll && access.readAll && !access.teacherId) {
      throw new AppError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk aksi ini.");
    }
    return { current, actorTeacherId: access.writeAll ? null : access.teacherId };
  }

  app.get("/schools/:schoolId/imports/learning-objectives/template", { preHandler: requireAuth }, async (request, reply) => {
    await importPlan(request, "objective");
    return csv(reply, "templat-tujuan-pembelajaran.csv", OBJECTIVE_TEMPLATE);
  });
  app.get("/schools/:schoolId/imports/material-scopes/template", { preHandler: requireAuth }, async (request, reply) => {
    await importPlan(request, "scope");
    return csv(reply, "templat-lingkup-materi.csv", SCOPE_TEMPLATE);
  });
  app.post("/schools/:schoolId/imports/learning-objectives/preview", { preHandler: requireAuth }, async (request) => {
    const { current, actorTeacherId } = await importPlan(request, "objective");
    const file = await request.file();
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Berkas wajib diunggah.");
    return previewPlanImport(app.prisma, current.params.schoolId, "objective", file.filename, await file.toBuffer(), actorTeacherId);
  });
  app.post("/schools/:schoolId/imports/material-scopes/preview", { preHandler: requireAuth }, async (request) => {
    const { current, actorTeacherId } = await importPlan(request, "scope");
    const file = await request.file();
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Berkas wajib diunggah.");
    return previewPlanImport(app.prisma, current.params.schoolId, "scope", file.filename, await file.toBuffer(), actorTeacherId);
  });
  app.post("/schools/:schoolId/imports/learning-objectives/commit", { preHandler: requireAuth }, async (request) => {
    const { current, actorTeacherId } = await importPlan(request, "objective");
    const body = parseInput(importCommitSchema, request.body ?? {});
    return commitPlanImport(app.prisma, current.auth, current.params.schoolId, "objective", body.rows.map((row) => row.data), current.meta, actorTeacherId);
  });
  app.post("/schools/:schoolId/imports/material-scopes/commit", { preHandler: requireAuth }, async (request) => {
    const { current, actorTeacherId } = await importPlan(request, "scope");
    const body = parseInput(importCommitSchema, request.body ?? {});
    return commitPlanImport(app.prisma, current.auth, current.params.schoolId, "scope", body.rows.map((row) => row.data), current.meta, actorTeacherId);
  });

  app.get("/schools/:schoolId/homeroom-grade-recap", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomRecapQuerySchema, request.query);
    return getHomeroomGradeRecap(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-grade-monitor", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomRecapQuerySchema, request.query);
    return getHomeroomGradeMonitor(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.get("/schools/:schoolId/attendance", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(attendanceListSchema, request.query);
    return getAttendanceBoard(app.prisma, current.auth, current.params.schoolId, query, current.meta);
  });
  app.post("/schools/:schoolId/attendance/meetings", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(attendanceCreateSchema, request.body ?? {});
    return createAttendanceMeeting(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/attendance/meetings/:meetingId", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(attendanceMeetingParamsSchema, request.params);
    return getAttendanceMeeting(app.prisma, current.auth, params.schoolId, params.meetingId, current.meta);
  });
  app.put("/schools/:schoolId/attendance/meetings/:meetingId", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(attendanceMeetingParamsSchema, request.params);
    const body = parseInput(attendanceDraftSchema, request.body ?? {});
    return saveAttendanceDraft(app.prisma, current.auth, params.schoolId, params.meetingId, body.records, current.meta);
  });
  app.post("/schools/:schoolId/attendance/meetings/:meetingId/finalize", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(attendanceMeetingParamsSchema, request.params);
    const body = parseInput(attendanceDraftSchema, request.body ?? {});
    return finalizeAttendanceMeeting(app.prisma, current.auth, params.schoolId, params.meetingId, body.records, current.meta);
  });
  app.post("/schools/:schoolId/attendance/meetings/:meetingId/correct", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(attendanceMeetingParamsSchema, request.params);
    const body = parseInput(attendanceCorrectSchema, request.body ?? {});
    return correctAttendanceMeeting(app.prisma, current.auth, params.schoolId, params.meetingId, body, current.meta);
  });
  app.get("/schools/:schoolId/attendance-completeness", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    return getAttendanceCompleteness(app.prisma, current.params.schoolId);
  });
  app.put("/schools/:schoolId/attendance-completeness", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    return saveAttendanceCompleteness(
      app.prisma,
      current.auth,
      current.params.schoolId,
      parseInput(attendanceCompletenessSaveSchema, request.body ?? {}),
      current.meta,
    );
  });
  app.post("/schools/:schoolId/attendance-completeness/activate", { preHandler: requireAuth }, async (request) => {
    const current = await coordinate(app, request);
    return activateAttendanceCompleteness(app.prisma, current.auth, current.params.schoolId, current.meta);
  });
  app.get("/schools/:schoolId/competency-descriptions", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(competencyDescriptionQuerySchema, request.query);
    return getCompetencyDescriptions(app.prisma, current.auth, current.params.schoolId, query.assignmentId, current.meta);
  });
  app.put("/schools/:schoolId/competency-descriptions", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(competencyDescriptionSaveSchema, request.body ?? {});
    return saveCompetencyDescriptionDraft(app.prisma, current.auth, current.params.schoolId, body.assignmentId, body.students, current.meta);
  });
  app.post("/schools/:schoolId/competency-descriptions/submit", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(competencyDescriptionSubmitSchema, request.body ?? {});
    return submitCompetencyDescription(app.prisma, current.auth, current.params.schoolId, body.assignmentId, current.meta);
  });
  app.post("/schools/:schoolId/competency-descriptions/revision", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(competencyDescriptionRevisionSchema, request.body ?? {});
    return requestCompetencyDescriptionRevision(app.prisma, current.auth, current.params.schoolId, body.assignmentId, body.reason, current.meta);
  });
  app.post("/schools/:schoolId/competency-descriptions/decision", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(competencyDescriptionDecisionSchema, request.body ?? {});
    return decideCompetencyDescriptionRevision(app.prisma, current.auth, current.params.schoolId, body.assignmentId, body.decision, body.note, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-competency-descriptions", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomDescriptionQuerySchema, request.query);
    return getHomeroomCompetencyDescriptions(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-notes", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomNoteQuerySchema, request.query);
    return getHomeroomNotes(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.put("/schools/:schoolId/homeroom-notes", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(homeroomNoteSaveSchema, request.body ?? {});
    return saveHomeroomNoteDraft(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/homeroom-notes/finalize", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(homeroomNoteSaveSchema, request.body ?? {});
    return finalizeHomeroomNote(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/homeroom-notes/correct", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(homeroomNoteCorrectSchema, request.body ?? {});
    return correctHomeroomNote(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-report-prep", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomRecapQuerySchema, request.query);
    return getHomeroomReportPrep(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-report-preview", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(homeroomRecapQuerySchema, request.query);
    return getHomeroomReportPreview(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.get("/schools/:schoolId/report-examinations", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(reportExaminationQuerySchema, request.query);
    return getReportExaminations(app.prisma, current.auth, current.params.schoolId, query.homeroomId, current.meta);
  });
  app.post("/schools/:schoolId/report-examinations/review", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(reportReviewSchema, request.body ?? {});
    return reviewReportCard(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/report-examinations/submit", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(reportReviewSchema, request.body ?? {});
    return submitReportCard(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/report-validations", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    return getReportQueue(app.prisma, current.auth, current.params.schoolId, "DIAJUKAN", current.meta);
  });
  app.post("/schools/:schoolId/report-validations/decision", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(reportDecisionSchema, request.body ?? {});
    return decideReportValidation(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/report-endorsements", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(reportQueueQuerySchema, request.query);
    return getReportQueue(app.prisma, current.auth, current.params.schoolId, query.view === "endorsed" ? "DISAHKAN" : "DISETUJUI_WAKAKUR", current.meta);
  });
  app.post("/schools/:schoolId/report-endorsements/decision", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(reportDecisionSchema, request.body ?? {});
    return decideReportEndorsement(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/report-endorsements/revision", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(reportRevisionSchema, request.body ?? {});
    return openReportRevision(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/report-dossiers", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(reportDossierQuerySchema, request.query);
    return getReportDossier(app.prisma, current.auth, current.params.schoolId, query.studentId, query.academicPeriodId, current.meta);
  });
  app.get("/schools/:schoolId/report-official-print", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(reportPrintQuerySchema, request.query);
    return readOfficialReportPrint(app.prisma, current.auth, current.params.schoolId, query.studentId, query.academicPeriodId, current.meta);
  });
  app.get("/schools/:schoolId/report-official-print.pdf", { preHandler: requireAuth }, async (request, reply) => {
    const current = context(request);
    const query = parseInput(reportPrintQuerySchema, request.query);
    const file = await readOfficialReportPdf(app.prisma, current.auth, current.params.schoolId, query.studentId, query.academicPeriodId, current.meta);
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    reply.header("Cache-Control", "no-store");
    return reply.send(file.body);
  });
  app.get("/schools/:schoolId/daily-attendance", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(dailyAttendanceQuerySchema, request.query);
    return getDailyAttendance(app.prisma, current.auth, current.params.schoolId, query.homeroomId, query.date, current.meta);
  });
  app.put("/schools/:schoolId/daily-attendance", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(dailyAttendanceDraftSchema, request.body ?? {});
    return saveDailyAttendance(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/daily-attendance/finalize", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(dailyAttendanceDraftSchema, request.body ?? {});
    return finalizeDailyAttendance(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.post("/schools/:schoolId/daily-attendance/correct", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const body = parseInput(dailyAttendanceCorrectSchema, request.body ?? {});
    return correctDailyAttendance(app.prisma, current.auth, current.params.schoolId, body, current.meta);
  });
  app.get("/schools/:schoolId/homeroom-attendance-recap", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(attendanceRecapQuerySchema, request.query);
    return getHomeroomAttendanceRecap(app.prisma, current.auth, current.params.schoolId, query.homeroomId, { from: query.from, to: query.to }, current.meta);
  });
  app.get("/schools/:schoolId/final-grades", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(finalGradeListQuerySchema, request.query);
    return listFinalGrades(app.prisma, current.auth, current.params.schoolId, query.view, current.meta);
  });
  app.get("/schools/:schoolId/teaching-assignments/:assignmentId/final-grades", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(gradeParamsSchema, request.params);
    const query = parseInput(finalGradeQuerySchema, request.query);
    return { sheet: await getFinalGradeSheet(app.prisma, current.auth, params.schoolId, params.assignmentId, query.basis, current.meta) };
  });
  app.post("/schools/:schoolId/teaching-assignments/:assignmentId/final-grades/commit", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const params = parseInput(gradeParamsSchema, request.params);
    parseInput(finalGradeCommitSchema, request.body ?? {});
    return { sheet: await commitFinalGrades(app.prisma, current.auth, params.schoolId, params.assignmentId, current.meta) };
  });

  app.get("/schools/:schoolId/teaching-assignments/:assignmentId/scores", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    return { sheet: await getGradeSheet(app.prisma, current.auth, params.schoolId, params.assignmentId, current.meta) };
  });
  app.patch("/schools/:schoolId/teaching-assignments/:assignmentId/scores", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    const body = parseInput(gradeSaveSchema, request.body ?? {});
    return { sheet: await saveGrades(app.prisma, current.auth, params.schoolId, params.assignmentId, body, current.meta) };
  });
  app.post("/schools/:schoolId/teaching-assignments/:assignmentId/scores/submit", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    const body = parseInput(gradeSubmitSchema, request.body ?? {});
    return { sheet: await submitGrades(app.prisma, current.auth, params.schoolId, params.assignmentId, body, current.meta) };
  });
  app.post("/schools/:schoolId/teaching-assignments/:assignmentId/scores/revision-request", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    const body = parseInput(gradeRevisionSchema, request.body ?? {});
    return { sheet: await requestGradeRevision(app.prisma, current.auth, params.schoolId, params.assignmentId, body, current.meta) };
  });
  app.post("/schools/:schoolId/teaching-assignments/:assignmentId/scores/revision-decision", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    const body = parseInput(gradeDecisionSchema, request.body ?? {});
    return { sheet: await decideGradeRevision(app.prisma, current.auth, params.schoolId, params.assignmentId, body, current.meta) };
  });
  app.post("/schools/:schoolId/teaching-assignments/:assignmentId/scores/resolve-legacy", { preHandler: requireAuth }, async (request) => {
    const params = parseInput(gradeParamsSchema, request.params);
    const current = context(request);
    const body = parseInput(gradeLegacyResolveSchema, request.body ?? {});
    return { sheet: await resolveLegacyGradeSubmission(app.prisma, current.auth, params.schoolId, params.assignmentId, body, current.meta) };
  });
  app.get("/schools/:schoolId/grade-workflows", { preHandler: requireAuth }, async (request) => {
    const current = context(request);
    const query = parseInput(gradeWorkflowQuerySchema, request.query);
    return { workflows: await listGradeWorkflows(app.prisma, current.auth, current.params.schoolId, query.view, current.meta) };
  });
}
