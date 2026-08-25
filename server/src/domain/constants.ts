/**
 * Domain sabitleri.
 *
 * Buradaki degerler "kod" (identifier) seviyesindedir; kullaniciya gosterilen
 * etiketler, hangi kategorinin hangi workflow'u kullandigi, SLA suresi, routing
 * kurallari gibi is davranislari veritabanindaki konfigurasyon tablolarinda
 * tutulur. Bu dosyada is kurali YOK, yalnizca gecerli deger kumeleri var.
 */

// ---------------------------------------------------------------------------
// Roller
// ---------------------------------------------------------------------------

export const ROLES = {
  EMPLOYEE: 'EMPLOYEE',
  MANAGER: 'MANAGER',
  HR_USER: 'HR_USER',
  HR_PROCESS_OWNER: 'HR_PROCESS_OWNER',
  ADMIN: 'ADMIN',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export const ROLE_CODES = Object.values(ROLES) as RoleCode[];

/** IK tarafinda talep isleyebilen roller. */
export const HR_ROLE_CODES: RoleCode[] = [ROLES.HR_USER, ROLES.HR_PROCESS_OWNER];

// ---------------------------------------------------------------------------
// Talep durumlari (referans tablosu StatusDefinition ile seed edilir)
// ---------------------------------------------------------------------------

export const STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PENDING_MANAGER_APPROVAL: 'PENDING_MANAGER_APPROVAL',
  HR_REVIEW: 'HR_REVIEW',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_INFO: 'PENDING_INFO',
  APPROVED: 'APPROVED',
  RESOLVED: 'RESOLVED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type StatusCode = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_PHASE = { OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;

// ---------------------------------------------------------------------------
// Oncelik
// ---------------------------------------------------------------------------

export const PRIORITY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const;
export type PriorityCode = (typeof PRIORITY)[keyof typeof PRIORITY];
export const PRIORITY_CODES = Object.values(PRIORITY) as PriorityCode[];

// ---------------------------------------------------------------------------
// Workflow tasarimi
// ---------------------------------------------------------------------------

export const WORKFLOW_DEFINITION_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WorkflowDefinitionStatus =
  (typeof WORKFLOW_DEFINITION_STATUS)[keyof typeof WORKFLOW_DEFINITION_STATUS];

export const WORKFLOW_VERSION_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WorkflowVersionStatus =
  (typeof WORKFLOW_VERSION_STATUS)[keyof typeof WORKFLOW_VERSION_STATUS];

export const STEP_TYPE = {
  START: 'START',
  APPROVAL: 'APPROVAL',
  REVIEW: 'REVIEW',
  TASK: 'TASK',
  END: 'END',
} as const;
export type StepType = (typeof STEP_TYPE)[keyof typeof STEP_TYPE];
export const STEP_TYPES = Object.values(STEP_TYPE) as StepType[];

export const ASSIGNEE_TYPE = {
  REQUESTER: 'REQUESTER',
  REQUESTER_MANAGER: 'REQUESTER_MANAGER',
  HR_USER: 'HR_USER',
  HR_PROCESS_OWNER: 'HR_PROCESS_OWNER',
  ROLE: 'ROLE',
  GROUP: 'GROUP',
  USER: 'USER',
} as const;
export type AssigneeType = (typeof ASSIGNEE_TYPE)[keyof typeof ASSIGNEE_TYPE];
export const ASSIGNEE_TYPES = Object.values(ASSIGNEE_TYPE) as AssigneeType[];

export const ACTION_KIND = {
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_INFO: 'REQUEST_INFO',
  COMPLETE: 'COMPLETE',
  CANCEL: 'CANCEL',
  FORWARD: 'FORWARD',
} as const;
export type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND];
export const ACTION_KINDS = Object.values(ACTION_KIND) as ActionKind[];

/** Aksiyonun hedef adimi nasil belirlenir. */
export const TARGET_STEP_MODE = {
  /** Kosulu saglanan bir sonraki adim */
  NEXT: 'NEXT',
  /** Belirli bir adim (targetStepId) */
  SPECIFIC: 'SPECIFIC',
  /** Akisi bitir */
  END: 'END',
  /** Ayni adimda kal (or. sadece durum degisir) */
  STAY: 'STAY',
  /** Talep sahibine geri don (ek bilgi isteme) */
  REQUESTER: 'REQUESTER',
} as const;
export type TargetStepMode = (typeof TARGET_STEP_MODE)[keyof typeof TARGET_STEP_MODE];
export const TARGET_STEP_MODES = Object.values(TARGET_STEP_MODE) as TargetStepMode[];

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export const INSTANCE_STATUS = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type InstanceStatus = (typeof INSTANCE_STATUS)[keyof typeof INSTANCE_STATUS];

export const STEP_INSTANCE_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type StepInstanceStatus =
  (typeof STEP_INSTANCE_STATUS)[keyof typeof STEP_INSTANCE_STATUS];

export const SLA_STATUS = {
  /** SLA tanimli degil */
  NA: 'NA',
  ON_TRACK: 'ON_TRACK',
  AT_RISK: 'AT_RISK',
  BREACHED: 'BREACHED',
  /** Kapanmis kayit: suresinde tamamlandi */
  MET: 'MET',
  /** Kapanmis kayit: suresi asilarak tamamlandi */
  MISSED: 'MISSED',
} as const;
export type SlaStatus = (typeof SLA_STATUS)[keyof typeof SLA_STATUS];

export const SLA_CALENDAR_MODE = {
  CALENDAR_DAYS: 'CALENDAR_DAYS',
  BUSINESS_DAYS: 'BUSINESS_DAYS',
} as const;
export type SlaCalendarMode = (typeof SLA_CALENDAR_MODE)[keyof typeof SLA_CALENDAR_MODE];

export const SKIP_REASON = {
  CONDITION_NOT_MET: 'CONDITION_NOT_MET',
  ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
  STEP_INACTIVE: 'STEP_INACTIVE',
} as const;

// ---------------------------------------------------------------------------
// Audit event tipleri
// ---------------------------------------------------------------------------

export const AUDIT_EVENT = {
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_UPDATED: 'REQUEST_UPDATED',
  REQUEST_SUBMITTED: 'REQUEST_SUBMITTED',
  STEP_STARTED: 'STEP_STARTED',
  STEP_COMPLETED: 'STEP_COMPLETED',
  STEP_SKIPPED: 'STEP_SKIPPED',
  ASSIGNED: 'ASSIGNED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INFO_REQUESTED: 'INFO_REQUESTED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
  SLA_WARNING: 'SLA_WARNING',
  SLA_BREACH: 'SLA_BREACH',
  NOTIFICATION_SENT: 'NOTIFICATION_SENT',
  ASSIGNEE_FALLBACK: 'ASSIGNEE_FALLBACK',
  // Konfigurasyon tarafi
  WORKFLOW_CREATED: 'WORKFLOW_CREATED',
  WORKFLOW_REVISION_CREATED: 'WORKFLOW_REVISION_CREATED',
  WORKFLOW_UPDATED: 'WORKFLOW_UPDATED',
  WORKFLOW_PUBLISHED: 'WORKFLOW_PUBLISHED',
  WORKFLOW_DEACTIVATED: 'WORKFLOW_DEACTIVATED',
  WORKFLOW_ARCHIVED: 'WORKFLOW_ARCHIVED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
} as const;
export type AuditEventType = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];

/** Timeline gorunurlugu. ADMIN olanlar normal kullanici timeline'inda gizlenir. */
export const AUDIT_VISIBILITY = { USER: 'USER', ADMIN: 'ADMIN' } as const;
export type AuditVisibility = (typeof AUDIT_VISIBILITY)[keyof typeof AUDIT_VISIBILITY];

// ---------------------------------------------------------------------------
// Bildirim
// ---------------------------------------------------------------------------

export const NOTIFICATION_EVENT = {
  REQUEST_SUBMITTED: 'REQUEST_SUBMITTED',
  STEP_STARTED: 'STEP_STARTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ROUTED_TO_HR: 'ROUTED_TO_HR',
  INFO_REQUESTED: 'INFO_REQUESTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  SLA_WARNING: 'SLA_WARNING',
  SLA_BREACH: 'SLA_BREACH',
  ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
  COMMENT_ADDED: 'COMMENT_ADDED',
} as const;
export type NotificationEvent =
  (typeof NOTIFICATION_EVENT)[keyof typeof NOTIFICATION_EVENT];
export const NOTIFICATION_EVENTS = Object.values(NOTIFICATION_EVENT) as NotificationEvent[];

export const NOTIFICATION_RECIPIENT_TYPE = {
  REQUESTER: 'REQUESTER',
  CURRENT_ASSIGNEE: 'CURRENT_ASSIGNEE',
  REQUESTER_MANAGER: 'REQUESTER_MANAGER',
  ROLE: 'ROLE',
  GROUP: 'GROUP',
} as const;
export type NotificationRecipientType =
  (typeof NOTIFICATION_RECIPIENT_TYPE)[keyof typeof NOTIFICATION_RECIPIENT_TYPE];
export const NOTIFICATION_RECIPIENT_TYPES = Object.values(
  NOTIFICATION_RECIPIENT_TYPE,
) as NotificationRecipientType[];

export const NOTIFICATION_CHANNEL = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  TEAMS: 'TEAMS',
} as const;
export type NotificationChannel =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

// ---------------------------------------------------------------------------
// Admin override (Live Operations)
// ---------------------------------------------------------------------------

export const OVERRIDE_TYPE = {
  REASSIGN: 'REASSIGN',
  SKIP_STEP: 'SKIP_STEP',
  MOVE_TO_STEP: 'MOVE_TO_STEP',
  CHANGE_STATUS: 'CHANGE_STATUS',
} as const;
export type OverrideType = (typeof OVERRIDE_TYPE)[keyof typeof OVERRIDE_TYPE];
export const OVERRIDE_TYPES = Object.values(OVERRIDE_TYPE) as OverrideType[];

export const OVERRIDE_REASON = {
  ORG_CHANGE: 'ORG_CHANGE',
  WRONG_ROUTING: 'WRONG_ROUTING',
  USER_LEFT: 'USER_LEFT',
  TECHNICAL_ERROR: 'TECHNICAL_ERROR',
  PROCESS_CORRECTION: 'PROCESS_CORRECTION',
  BUSINESS_DECISION: 'BUSINESS_DECISION',
  OTHER: 'OTHER',
} as const;
export type OverrideReason = (typeof OVERRIDE_REASON)[keyof typeof OVERRIDE_REASON];
export const OVERRIDE_REASONS = Object.values(OVERRIDE_REASON) as OverrideReason[];

/** OTHER secildiginde aciklama zorunlu. */
export const OVERRIDE_REASON_LABELS: Record<OverrideReason, string> = {
  ORG_CHANGE: 'Organizasyon degisikligi',
  WRONG_ROUTING: 'Yanlis yonlendirme',
  USER_LEFT: 'Kullanici sistemden ayrildi',
  TECHNICAL_ERROR: 'Teknik hata',
  PROCESS_CORRECTION: 'Surec duzeltmesi',
  BUSINESS_DECISION: 'Is karari',
  OTHER: 'Diger',
};

// ---------------------------------------------------------------------------
// Form alan tipleri
// ---------------------------------------------------------------------------

export const FIELD_TYPE = {
  TEXT: 'TEXT',
  LONG_TEXT: 'LONG_TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  DROPDOWN: 'DROPDOWN',
  MULTI_SELECT: 'MULTI_SELECT',
  USER: 'USER',
  FILE: 'FILE',
  CHECKBOX: 'CHECKBOX',
} as const;
export type FieldType = (typeof FIELD_TYPE)[keyof typeof FIELD_TYPE];
export const FIELD_TYPES = Object.values(FIELD_TYPE) as FieldType[];

// ---------------------------------------------------------------------------
// Kosul (routing) operatorleri - genel amacli rule engine DEGIL
// ---------------------------------------------------------------------------

export const CONDITION_OPERATOR = {
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  IN: 'IN',
  NOT_IN: 'NOT_IN',
  IS_EMPTY: 'IS_EMPTY',
  IS_NOT_EMPTY: 'IS_NOT_EMPTY',
} as const;
export type ConditionOperator =
  (typeof CONDITION_OPERATOR)[keyof typeof CONDITION_OPERATOR];
export const CONDITION_OPERATORS = Object.values(
  CONDITION_OPERATOR,
) as ConditionOperator[];

export const CONDITION_COMBINATOR = { AND: 'AND', OR: 'OR' } as const;
export type ConditionCombinator =
  (typeof CONDITION_COMBINATOR)[keyof typeof CONDITION_COMBINATOR];

/**
 * Kosullarda kullanilabilecek alanlarin beyaz listesi.
 * Admin bunlarin disinda bir alana / arbitrary ifadeye erisemez.
 */
export const CONDITION_FIELDS = [
  { path: 'category.code', label: 'Talep Kategorisi (kod)', valueSource: 'CATEGORY' },
  {
    path: 'category.requiresManagerApproval',
    label: 'Kategori yonetici onayi gerektiriyor mu',
    valueSource: 'BOOLEAN',
  },
  { path: 'request.priority', label: 'Oncelik', valueSource: 'PRIORITY' },
  { path: 'request.departmentCode', label: 'Departman (kod)', valueSource: 'TEXT' },
  { path: 'requester.hasManager', label: 'Talep edenin yoneticisi var mi', valueSource: 'BOOLEAN' },
  { path: 'requester.departmentCode', label: 'Talep eden departman (kod)', valueSource: 'TEXT' },
  { path: 'requester.title', label: 'Talep eden unvan', valueSource: 'TEXT' },
] as const;

/** form.<alanKodu> serbest birakilir; prefix beyaz listede. */
export const CONDITION_FIELD_PREFIXES = [
  'category.',
  'request.',
  'requester.',
  'form.',
] as const;

// ---------------------------------------------------------------------------
// AppSetting anahtarlari
// ---------------------------------------------------------------------------

export const SETTING_KEYS = {
  SLA_CALENDAR_MODE: 'sla.calendarMode',
  SLA_WORK_DAY_START_HOUR: 'sla.workDayStartHour',
  SLA_WORK_DAY_END_HOUR: 'sla.workDayEndHour',
  SLA_AT_RISK_THRESHOLD_PCT: 'sla.atRiskThresholdPercent',
  SLA_INCLUDE_WEEKENDS: 'sla.includeWeekends',
  NOTIFICATION_CHANNELS_ENABLED: 'notification.enabledChannels',
  ASSIGNEE_FALLBACK_ROLE: 'assignee.fallbackRoleCode',
  ATTACHMENT_MAX_SIZE_MB: 'attachment.maxSizeMb',
  ATTACHMENT_ALLOWED_MIME: 'attachment.allowedMimeTypes',
} as const;
