/**
 * Admin API.
 *
 * GUVENLIK: Tum bu router requireAuth + requireAdmin arkasindadir. Frontend'de
 * menuyu gizlemek yeterli degildir; yetki burada zorlanir. Ayrica live-ops
 * servisi kendi icinde bir kez daha admin kontrolu yapar.
 *
 * Bu API uzerinden dogrudan tablo/kolon guncellemesi YAPILAMAZ; yalnizca
 * tanimli is islemleri sunulur.
 */

import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAdmin, requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/error';
import {
  ACTION_KINDS,
  ASSIGNEE_TYPES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  FIELD_TYPES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_RECIPIENT_TYPES,
  OVERRIDE_REASON_LABELS,
  OVERRIDE_REASONS,
  OVERRIDE_TYPES,
  SLA_CALENDAR_MODE,
  STEP_TYPES,
  TARGET_STEP_MODES,
  type OverrideReason,
  type OverrideType,
} from '../domain/constants';
import {
  addAction,
  addStep,
  copyDefinition,
  createDefinition,
  createRevision,
  deleteAction,
  deleteDraftVersion,
  deleteStep,
  getVersionDetail,
  listDefinitions,
  listVersions,
  moveStep,
  publishVersion,
  setDefinitionStatus,
  setNotificationRules,
  updateAction,
  updateDefinitionHeader,
  updateStep,
  updateVersionHeader,
  validateVersion,
} from '../services/workflow-admin.service';
import {
  addFormField,
  createCategory,
  deactivateCategory,
  getCategoryForAdmin,
  listCategoriesForAdmin,
  listSettings,
  removeFormField,
  updateCategory,
  updateFormField,
  updateSetting,
} from '../services/category-admin.service';
import {
  applyOverride,
  getLiveInstanceDetail,
  listLiveInstances,
  listOverrides,
  previewOverride,
  type OverrideInput,
} from '../services/live-ops.service';
import { listAdminOverrideStatuses } from '../services/catalog.service';
import { runSlaEvaluation } from '../jobs/sla.job';

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireAdmin);

const rowVersionSchema = z
  .number({ invalid_type_error: 'Kayıt sürümü (expectedRowVersion) gönderilmelidir.' })
  .int()
  .min(1);

function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value).trim();
  return text ? text.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

function toInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

// ===========================================================================
// Meta: editorun ihtiyac duydugu secenek listeleri
// ===========================================================================

adminRoutes.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    res.json({
      stepTypes: STEP_TYPES,
      assigneeTypes: ASSIGNEE_TYPES,
      actionKinds: ACTION_KINDS,
      targetStepModes: TARGET_STEP_MODES,
      fieldTypes: FIELD_TYPES,
      conditionOperators: CONDITION_OPERATORS,
      conditionFields: CONDITION_FIELDS,
      notificationEvents: NOTIFICATION_EVENTS,
      notificationRecipientTypes: NOTIFICATION_RECIPIENT_TYPES,
      slaCalendarModes: Object.values(SLA_CALENDAR_MODE),
      overrideTypes: OVERRIDE_TYPES,
      overrideReasons: OVERRIDE_REASONS.map((code) => ({
        code,
        label: OVERRIDE_REASON_LABELS[code],
      })),
      adminOverrideStatuses: await listAdminOverrideStatuses(),
    });
  }),
);

// ===========================================================================
// Workflow tanimlari
// ===========================================================================

adminRoutes.get(
  '/workflows',
  asyncHandler(async (req, res) => {
    res.json(
      await listDefinitions({ includeArchived: req.query.includeArchived === 'true' }),
    );
  }),
);

adminRoutes.post(
  '/workflows',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        code: z.string().min(2).max(50),
        name: z.string().min(2).max(150),
        description: z.string().max(1000).optional().nullable(),
        useStarterTemplate: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createDefinition(user, input));
  }),
);

adminRoutes.patch(
  '/workflows/:definitionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        name: z.string().min(2).max(150).optional(),
        description: z.string().max(1000).optional().nullable(),
      })
      .parse(req.body);
    res.json(await updateDefinitionHeader(user, req.params.definitionId, input));
  }),
);

adminRoutes.get(
  '/workflows/:definitionId/versions',
  asyncHandler(async (req, res) => {
    res.json(await listVersions(req.params.definitionId));
  }),
);

/** Revizyon olustur: aktif surum degismez, yeni DRAFT surum uretilir. */
adminRoutes.post(
  '/workflows/:definitionId/revisions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({ changeDescription: z.string().max(1000).optional().nullable() })
      .parse(req.body ?? {});
    res.status(201).json(await createRevision(user, req.params.definitionId, input));
  }),
);

adminRoutes.post(
  '/workflows/:definitionId/copy',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({ code: z.string().min(2).max(50), name: z.string().min(2).max(150) })
      .parse(req.body);
    res.status(201).json(await copyDefinition(user, req.params.definitionId, input));
  }),
);

adminRoutes.post(
  '/workflows/:definitionId/status',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { status } = z
      .object({ status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']) })
      .parse(req.body);
    res.json(await setDefinitionStatus(user, req.params.definitionId, status));
  }),
);

// ===========================================================================
// Workflow surumleri (editor)
// ===========================================================================

adminRoutes.get(
  '/workflow-versions/:versionId',
  asyncHandler(async (req, res) => {
    res.json(await getVersionDetail(req.params.versionId));
  }),
);

adminRoutes.patch(
  '/workflow-versions/:versionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        changeDescription: z.string().max(1000).optional().nullable(),
        slaCalendarMode: z.enum(['CALENDAR_DAYS', 'BUSINESS_DAYS']).optional(),
        expectedRowVersion: rowVersionSchema,
      })
      .parse(req.body);
    res.json(await updateVersionHeader(user, req.params.versionId, input));
  }),
);

adminRoutes.delete(
  '/workflow-versions/:versionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await deleteDraftVersion(user, req.params.versionId));
  }),
);

adminRoutes.get(
  '/workflow-versions/:versionId/validate',
  asyncHandler(async (req, res) => {
    res.json(await validateVersion(req.params.versionId));
  }),
);

adminRoutes.post(
  '/workflow-versions/:versionId/publish',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        expectedRowVersion: rowVersionSchema,
        changeDescription: z.string().max(1000).optional().nullable(),
      })
      .parse(req.body);
    res.json(await publishVersion(user, req.params.versionId, input));
  }),
);

// --- Adimlar ---

const stepBodySchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(150),
  description: z.string().max(1000).optional().nullable(),
  type: z.string().min(1),
  assigneeType: z.string().min(1),
  assigneeRoleCode: z.string().optional().nullable(),
  assigneeGroupId: z.string().optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
  statusCode: z.string().min(1),
  slaEnabled: z.boolean().optional(),
  slaHours: z.number().int().min(1).max(8760).optional().nullable(),
  slaReminderHours: z.number().int().min(1).max(8760).optional().nullable(),
  slaEscalationHours: z.number().int().min(1).max(8760).optional().nullable(),
  condition: z.unknown().optional(),
  isActive: z.boolean().optional(),
  expectedRowVersion: rowVersionSchema,
});

adminRoutes.post(
  '/workflow-versions/:versionId/steps',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = stepBodySchema.parse(req.body);
    res.status(201).json(await addStep(user, req.params.versionId, input));
  }),
);

adminRoutes.patch(
  '/workflow-steps/:stepId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = stepBodySchema.partial().extend({ expectedRowVersion: rowVersionSchema }).parse(req.body);
    res.json(await updateStep(user, req.params.stepId, input));
  }),
);

adminRoutes.delete(
  '/workflow-steps/:stepId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z.object({ expectedRowVersion: rowVersionSchema }).parse(req.body);
    res.json(await deleteStep(user, req.params.stepId, input));
  }),
);

adminRoutes.post(
  '/workflow-steps/:stepId/move',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        direction: z.enum(['up', 'down']),
        expectedRowVersion: rowVersionSchema,
      })
      .parse(req.body);
    res.json(await moveStep(user, req.params.stepId, input));
  }),
);

// --- Aksiyonlar ---

const actionBodySchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(60),
  kind: z.string().min(1),
  targetStepMode: z.string().min(1),
  targetStepId: z.string().optional().nullable(),
  targetStatusCode: z.string().optional().nullable(),
  commentRequired: z.boolean().optional(),
  confirmationRequired: z.boolean().optional(),
  notify: z.boolean().optional(),
  variant: z.enum(['PRIMARY', 'DANGER', 'DEFAULT']).optional(),
  isActive: z.boolean().optional(),
  expectedRowVersion: rowVersionSchema,
});

adminRoutes.post(
  '/workflow-steps/:stepId/actions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = actionBodySchema.parse(req.body);
    res.status(201).json(await addAction(user, req.params.stepId, input));
  }),
);

adminRoutes.patch(
  '/workflow-actions/:actionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = actionBodySchema.partial().extend({ expectedRowVersion: rowVersionSchema }).parse(req.body);
    res.json(await updateAction(user, req.params.actionId, input));
  }),
);

adminRoutes.delete(
  '/workflow-actions/:actionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z.object({ expectedRowVersion: rowVersionSchema }).parse(req.body);
    res.json(await deleteAction(user, req.params.actionId, input));
  }),
);

// --- Bildirim kurallari ---

adminRoutes.put(
  '/workflow-versions/:versionId/notification-rules',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        rules: z.array(
          z.object({
            event: z.string().min(1),
            recipientType: z.string().min(1),
            recipientRoleCode: z.string().optional().nullable(),
            recipientGroupId: z.string().optional().nullable(),
            channel: z.enum(['IN_APP', 'EMAIL', 'TEAMS']).optional(),
            isActive: z.boolean().optional(),
          }),
        ),
        expectedRowVersion: rowVersionSchema,
      })
      .parse(req.body);
    res.json(await setNotificationRules(user, req.params.versionId, input));
  }),
);

// ===========================================================================
// Kategoriler ve form konfigurasyonu
// ===========================================================================

adminRoutes.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json(await listCategoriesForAdmin());
  }),
);

adminRoutes.get(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    res.json(await getCategoryForAdmin(req.params.categoryId));
  }),
);

const categoryBodySchema = z.object({
  code: z.string().min(2).max(50).optional(),
  name: z.string().min(2).max(150).optional(),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  requiresManagerApproval: z.boolean().optional(),
  defaultPriority: z.string().optional(),
  defaultSlaHours: z.number().int().min(1).max(8760).optional().nullable(),
  ownerRoleCode: z.string().optional().nullable(),
  ownerGroupId: z.string().optional().nullable(),
  requestNoPrefix: z.string().max(8).optional().nullable(),
  workflowDefinitionId: z.string().optional().nullable(),
});

adminRoutes.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = categoryBodySchema
      .extend({ code: z.string().min(2).max(50), name: z.string().min(2).max(150) })
      .parse(req.body);
    res.status(201).json(await createCategory(user, input));
  }),
);

adminRoutes.patch(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = categoryBodySchema.parse(req.body);
    res.json(await updateCategory(user, req.params.categoryId, input));
  }),
);

adminRoutes.post(
  '/categories/:categoryId/deactivate',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await deactivateCategory(user, req.params.categoryId));
  }),
);

const formFieldBodySchema = z.object({
  key: z.string().min(2).max(40).optional(),
  label: z.string().min(2).max(150).optional(),
  fieldType: z.string().optional(),
  isRequired: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  defaultValue: z.string().max(1000).optional().nullable(),
  helpText: z.string().max(500).optional().nullable(),
  placeholder: z.string().max(200).optional().nullable(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().optional(),
      maxLength: z.number().int().optional(),
      pattern: z.string().max(200).optional(),
    })
    .optional()
    .nullable(),
  visibilityCondition: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

adminRoutes.post(
  '/categories/:categoryId/form-fields',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = formFieldBodySchema
      .extend({ key: z.string().min(2).max(40), label: z.string().min(2).max(150) })
      .parse(req.body);
    res.status(201).json(await addFormField(user, req.params.categoryId, input));
  }),
);

adminRoutes.patch(
  '/form-fields/:fieldId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = formFieldBodySchema.parse(req.body);
    res.json(await updateFormField(user, req.params.fieldId, input));
  }),
);

adminRoutes.delete(
  '/form-fields/:fieldId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await removeFormField(user, req.params.fieldId));
  }),
);

// ===========================================================================
// Sistem ayarlari
// ===========================================================================

adminRoutes.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await listSettings());
  }),
);

adminRoutes.patch(
  '/settings/:key',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { value } = z.object({ value: z.string().max(2000) }).parse(req.body);
    res.json(await updateSetting(user, req.params.key, value));
  }),
);

// ===========================================================================
// LIVE OPERATIONS (spec 03)
// Surec TANIMINI degil, CALISAN kaydi etkiler.
// ===========================================================================

adminRoutes.get(
  '/live/instances',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const q = req.query;
    res.json(
      await listLiveInstances(user, {
        requestNo: q.requestNo ? String(q.requestNo) : undefined,
        requesterId: q.requesterId ? String(q.requesterId) : undefined,
        definitionId: q.definitionId ? String(q.definitionId) : undefined,
        versionId: q.versionId ? String(q.versionId) : undefined,
        categoryId: q.categoryId ? String(q.categoryId) : undefined,
        statusCode: toArray(q.statusCode),
        stepCode: q.stepCode ? String(q.stepCode) : undefined,
        assigneeId: q.assigneeId ? String(q.assigneeId) : undefined,
        slaStatus: toArray(q.slaStatus),
        instanceStatus: toArray(q.instanceStatus),
        startedFrom: q.startedFrom ? String(q.startedFrom) : undefined,
        startedTo: q.startedTo ? String(q.startedTo) : undefined,
        search: q.search ? String(q.search) : undefined,
        page: toInt(q.page),
        pageSize: toInt(q.pageSize),
      }),
    );
  }),
);

adminRoutes.get(
  '/live/requests/:requestId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await getLiveInstanceDetail(user, req.params.requestId));
  }),
);

const overrideBodySchema = z.object({
  overrideType: z.enum(['REASSIGN', 'SKIP_STEP', 'MOVE_TO_STEP', 'CHANGE_STATUS']),
  reasonCode: z.enum([
    'ORG_CHANGE',
    'WRONG_ROUTING',
    'USER_LEFT',
    'TECHNICAL_ERROR',
    'PROCESS_CORRECTION',
    'BUSINESS_DECISION',
    'OTHER',
  ]),
  reasonNote: z.string().max(2000).optional().nullable(),
  targetAssigneeId: z.string().optional().nullable(),
  targetStepId: z.string().optional().nullable(),
  targetStatusCode: z.string().optional().nullable(),
  expectedRowVersion: rowVersionSchema,
});

function toOverrideInput(requestId: string, body: unknown): OverrideInput {
  const parsed = overrideBodySchema.parse(body);
  return {
    requestId,
    overrideType: parsed.overrideType as OverrideType,
    reasonCode: parsed.reasonCode as OverrideReason,
    reasonNote: parsed.reasonNote ?? null,
    targetAssigneeId: parsed.targetAssigneeId ?? null,
    targetStepId: parsed.targetStepId ?? null,
    targetStatusCode: parsed.targetStatusCode ?? null,
    expectedRowVersion: parsed.expectedRowVersion,
  };
}

/** Impact Preview: hicbir degisiklik yapmaz. */
adminRoutes.post(
  '/live/requests/:requestId/override/preview',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await previewOverride(user, toOverrideInput(req.params.requestId, req.body)));
  }),
);

/** Onaydan sonra uygulama. */
adminRoutes.post(
  '/live/requests/:requestId/override',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = toOverrideInput(req.params.requestId, req.body);

    // Kullanicinin preview gordugunu dogrulayan acik onay bayragi.
    const { confirmed } = z
      .object({ confirmed: z.literal(true, { errorMap: () => ({ message: 'Müdahale için onay (confirmed) gereklidir.' }) }) })
      .parse(req.body);
    void confirmed;

    res.json(await applyOverride(user, input));
  }),
);

adminRoutes.get(
  '/live/overrides',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(
      await listOverrides(user, {
        requestId: req.query.requestId ? String(req.query.requestId) : undefined,
        adminUserId: req.query.adminUserId ? String(req.query.adminUserId) : undefined,
        overrideType: req.query.overrideType ? String(req.query.overrideType) : undefined,
        page: toInt(req.query.page),
        pageSize: toInt(req.query.pageSize),
      }),
    );
  }),
);

/** SLA degerlendirmesini elle tetikleme (operasyonel destek). */
adminRoutes.post(
  '/live/sla/evaluate',
  asyncHandler(async (_req, res) => {
    res.json(await runSlaEvaluation());
  }),
);
