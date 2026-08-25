/** Sunucu DTO tipleri (backend yanitlariyla birebir). */

export interface StatusInfo {
  code: string;
  name: string;
  tone: string;
  phase?: string;
  isTerminal?: boolean;
  allowAdminOverride?: boolean;
  sortOrder?: number;
}

export interface PriorityInfo {
  code: string;
  name: string;
  tone: string;
  sortOrder?: number;
}

export interface UserRef {
  id: string;
  displayName: string;
  title?: string | null;
  email?: string | null;
  department?: string | null;
  employeeNo?: string | null;
}

export interface CategoryRef {
  id: string;
  code: string;
  name: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  department: string | null;
  departmentCode: string | null;
  title: string | null;
  manager: UserRef | null;
  roles: string[];
  groupIds: string[];
  capabilities: {
    canCreateRequest: boolean;
    hasTasks: boolean;
    isHr: boolean;
    isAdmin: boolean;
  };
}

export interface CategoryListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requiresManagerApproval: boolean;
  defaultPriority: string;
  defaultSlaHours: number | null;
  workflowDefinitionId: string | null;
  workflowName: string | null;
  hasActiveWorkflow: boolean;
  sortOrder: number;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormFieldConfig {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isHidden: boolean;
  defaultValue: string | null;
  helpText: string | null;
  placeholder: string | null;
  options: FieldOption[];
  validation: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  } | null;
  visibilityConditionJson: string | null;
  sortOrder: number;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: T[];
}

export interface RequestListItem {
  id: string;
  requestNo: string;
  subject: string;
  category: CategoryRef;
  requester: UserRef;
  status: StatusInfo;
  priority: PriorityInfo;
  currentStepName: string | null;
  currentAssigneeLabel: string | null;
  dueDate: string | null;
  slaDueAt: string | null;
  slaStatus: string;
  slaRemainingText: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  rowVersion: number;
}

export interface TaskListItem extends RequestListItem {
  isPoolTask: boolean;
}

export interface ProgressStep {
  id: string;
  stepCode: string;
  stepName: string;
  stepType: string;
  sequence: number;
  status: string;
  phase: 'past' | 'current' | 'future' | 'skipped';
  assigneeLabel: string | null;
  statusCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  dueAt: string | null;
  slaStatus: string;
  resultActionCode: string | null;
  resultComment: string | null;
  skipReason: string | null;
  isAwaitingInfo: boolean;
}

export interface TimelineEntry {
  id: string;
  eventType: string;
  label: string;
  occurredAt: string;
  userDisplayName: string | null;
  userRole: string | null;
  stepName: string | null;
  oldStatusName: string | null;
  newStatusName: string | null;
  description: string | null;
  visibility: string;
}

export interface ApprovalEntry {
  id: string;
  stepName: string | null;
  actionName: string | null;
  actionKind: string;
  performedBy: UserRef;
  performedByRole: string | null;
  comment: string | null;
  createdAt: string;
}

export interface AttachmentItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: UserRef;
  uploadedAt: string;
}

export interface CommentItem {
  id: string;
  body: string;
  author: UserRef;
  isInternal: boolean;
  createdAt: string;
}

export interface AvailableAction {
  code: string;
  name: string;
  kind: string;
  variant: string;
  commentRequired: boolean;
  confirmationRequired: boolean;
}

export interface RequestDetail {
  id: string;
  requestNo: string;
  subject: string;
  description: string | null;
  category: CategoryRef & { requiresManagerApproval: boolean };
  status: StatusInfo;
  priority: PriorityInfo;
  requester: UserRef;
  manager: UserRef | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  sla: { dueAt: string | null; status: string; remainingText: string | null };
  workflow: {
    instanceId: string;
    definitionName: string;
    definitionCode: string;
    versionId: string;
    versionNumber: number;
    instanceStatus: string;
    startedAt: string;
  } | null;
  currentStep: ProgressStep | null;
  whoHasIt: string | null;
  nextExpectedStep: { stepName: string; assigneeLabel: string | null } | null;
  progress: ProgressStep[];
  timeline: TimelineEntry[];
  approvalHistory: ApprovalEntry[];
  attachments: AttachmentItem[];
  comments: CommentItem[];
  formFields: FormFieldConfig[];
  formData: Record<string, unknown>;
  availableActions: AvailableAction[];
  rowVersion: number;
  permissions: {
    canEdit: boolean;
    canSubmit: boolean;
    canCancel: boolean;
    canComment: boolean;
    canUpload: boolean;
    canAct: boolean;
    canViewInternalNotes: boolean;
    isOwner: boolean;
    isAdmin: boolean;
  };
}

export interface NotificationItem {
  id: string;
  requestId: string | null;
  event: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ReportSummary {
  totals: {
    total: number;
    open: number;
    completed: number;
    rejected: number;
    cancelled: number;
    draft: number;
  };
  durations: {
    averageFirstResponseHours: number | null;
    averageCompletionHours: number | null;
    sampleSizeFirstResponse: number;
    sampleSizeCompletion: number;
  };
  sla: {
    met: number;
    missed: number;
    breachedOpen: number;
    atRiskOpen: number;
    notApplicable: number;
    compliancePercent: number | null;
  };
  byStatus: Array<{ code: string; name: string; tone: string; count: number }>;
  byCategory: Array<{
    id: string;
    code: string;
    name: string;
    count: number;
    openCount: number;
  }>;
  byPriority: Array<{ code: string; name: string; tone: string; count: number }>;
  byDepartment: Array<{ department: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Admin - workflow konfigurasyonu
// ---------------------------------------------------------------------------

export interface WorkflowListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  categories: CategoryRef[];
  activeVersion: { id: string; versionNumber: number; publishedAt: string | null } | null;
  draftVersion: { id: string; versionNumber: number; status: string } | null;
  versionCount: number;
  updatedAt: string;
  updatedByName: string | null;
  activeInstanceCount: number;
}

export interface WorkflowActionConfig {
  id: string;
  code: string;
  name: string;
  kind: string;
  targetStepMode: string;
  targetStepId: string | null;
  targetStepName: string | null;
  targetStatusCode: string | null;
  commentRequired: boolean;
  confirmationRequired: boolean;
  notify: boolean;
  variant: string;
  sortOrder: number;
  isActive: boolean;
}

export interface WorkflowStepConfig {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  sequence: number;
  assigneeType: string;
  assigneeRoleCode: string | null;
  assigneeGroupId: string | null;
  assigneeUserId: string | null;
  statusCode: string;
  slaEnabled: boolean;
  slaHours: number | null;
  slaReminderHours: number | null;
  slaEscalationHours: number | null;
  conditionJson: string | null;
  conditionSummary: string;
  conditionValid: boolean;
  isActive: boolean;
  actions: WorkflowActionConfig[];
}

export interface NotificationRuleConfig {
  id: string;
  event: string;
  recipientType: string;
  recipientRoleCode: string | null;
  recipientGroupId: string | null;
  channel: string;
  isActive: boolean;
}

export interface WorkflowVersionDetail {
  id: string;
  versionNumber: number;
  status: string;
  changeDescription: string | null;
  slaCalendarMode: string;
  createdAt: string;
  publishedAt: string | null;
  rowVersion: number;
  isEditable: boolean;
  runningInstanceCount: number;
  totalInstanceCount: number;
  definition: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    activeVersionId: string | null;
    categories: CategoryRef[];
  };
  steps: WorkflowStepConfig[];
  notificationRules: NotificationRuleConfig[];
}

export interface WorkflowVersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  changeDescription: string | null;
  slaCalendarMode: string;
  createdAt: string;
  createdByName: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  stepCount: number;
  totalInstanceCount: number;
  runningInstanceCount: number;
  isActive: boolean;
  rowVersion: number;
}

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  stepId?: string;
  stepName?: string;
  actionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  canPublish: boolean;
  issues: ValidationIssue[];
}

export interface AdminMeta {
  stepTypes: string[];
  assigneeTypes: string[];
  actionKinds: string[];
  targetStepModes: string[];
  fieldTypes: string[];
  conditionOperators: string[];
  conditionFields: Array<{ path: string; label: string; valueSource: string }>;
  notificationEvents: string[];
  notificationRecipientTypes: string[];
  slaCalendarModes: string[];
  overrideTypes: string[];
  overrideReasons: Array<{ code: string; label: string }>;
  adminOverrideStatuses: StatusInfo[];
}

export interface AdminCategoryListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  requiresManagerApproval: boolean;
  defaultPriority: string;
  defaultSlaHours: number | null;
  ownerRoleCode: string | null;
  ownerGroupId: string | null;
  requestNoPrefix: string | null;
  workflow: { id: string; code: string; name: string; status: string; activeVersionId: string | null } | null;
  hasPublishedWorkflow: boolean;
  requestCount: number;
  openRequestCount: number;
  formFieldCount: number;
}

export interface AdminCategoryDetail extends Omit<AdminCategoryListItem, 'workflow'> {
  workflowDefinitionId: string | null;
  workflow: AdminCategoryListItem['workflow'];
  formFields: Array<
    Omit<FormFieldConfig, 'visibilityConditionJson'> & {
      visibilityConditionJson: string | null;
      isActive: boolean;
    }
  >;
}

// ---------------------------------------------------------------------------
// Admin - live operations
// ---------------------------------------------------------------------------

export interface LiveInstanceListItem {
  instanceId: string;
  requestId: string;
  requestNo: string;
  subject: string;
  requester: UserRef;
  category: CategoryRef;
  workflow: { id: string; code: string; name: string };
  workflowVersion: number;
  workflowVersionId: string;
  workflowVersionStatus: string;
  currentStepCode: string | null;
  currentStepName: string | null;
  currentStatus: StatusInfo;
  currentAssigneeLabel: string | null;
  currentAssigneeId: string | null;
  isPoolTask: boolean;
  instanceStatus: string;
  startedAt: string;
  completedAt: string | null;
  lastAction: { actionName: string | null; at: string; byName: string } | null;
  slaDueAt: string | null;
  slaStatus: string;
  slaRemainingText: string | null;
  rowVersion: number;
}

export interface LiveInstanceDetail {
  request: {
    id: string;
    requestNo: string;
    subject: string;
    description: string | null;
    category: { id: string; code: string; name: string };
    requester: UserRef & { isActive: boolean };
    priority: PriorityInfo | null;
    status: StatusInfo | null;
    createdAt: string;
    submittedAt: string | null;
    closedAt: string | null;
    formData: Record<string, unknown>;
    rowVersion: number;
  };
  workflow: {
    instanceId: string;
    definitionId: string;
    definitionName: string;
    definitionCode: string;
    versionId: string;
    versionNumber: number;
    versionStatus: string;
    isRunningOnSupersededVersion: boolean;
    instanceStatus: string;
    startedAt: string;
    completedAt: string | null;
    slaCalendarMode: string;
  };
  currentStep: {
    stepInstanceId: string;
    stepId: string;
    code: string;
    name: string;
    type: string;
    sequence: number;
    status: string;
    statusCode: string | null;
    assigneeId: string | null;
    assigneeLabel: string | null;
    assigneeType: string | null;
    assigneeRoleCode: string | null;
    assigneeGroupId: string | null;
    startedAt: string | null;
    dueAt: string | null;
    slaStatus: string;
    isAwaitingInfo: boolean;
  } | null;
  previousStep: { name: string; completedAt: string | null; resultActionCode: string | null } | null;
  nextExpectedStep: { stepId: string; name: string; assigneeLabel: string | null } | null;
  operations: {
    slaDueAt: string | null;
    slaStatus: string;
    slaRemainingText: string | null;
    stepStartedAt: string | null;
    lastAction: { actionName: string | null; at: string; byName: string } | null;
  };
  timeline: Array<{
    stepInstanceId: string;
    stepId: string;
    code: string;
    name: string;
    type: string;
    sequence: number;
    status: string;
    assigneeLabel: string | null;
    startedAt: string | null;
    completedAt: string | null;
    dueAt: string | null;
    slaStatus: string;
    resultActionCode: string | null;
    resultComment: string | null;
    skipReason: string | null;
    isCurrent: boolean;
  }>;
  approvalHistory: Array<
    ApprovalEntry & { fromStatusCode: string | null; toStatusCode: string | null }
  >;
  auditTrail: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    userDisplayName: string | null;
    userRole: string | null;
    stepName: string | null;
    oldStatusCode: string | null;
    newStatusCode: string | null;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    description: string | null;
    visibility: string;
    workflowVersionNumber: number | null;
    metadata: Record<string, unknown>;
  }>;
  overrideHistory: Array<{
    id: string;
    overrideType: string;
    reasonCode: string;
    reasonLabel: string;
    reasonNote: string | null;
    fromStepName: string | null;
    toStepName: string | null;
    fromStatusCode: string | null;
    toStatusCode: string | null;
    adminUser: UserRef;
    createdAt: string;
    workflowVersionNumber: number | null;
  }>;
  overrideOptions: {
    types: string[];
    reasons: Array<{ code: string; label: string }>;
    allowedStatuses: StatusInfo[];
    moveTargets: Array<{
      stepId: string;
      code: string;
      name: string;
      type: string;
      sequence: number;
      statusCode: string;
      assigneeType: string;
      isRevisit: boolean;
    }>;
    canOverride: boolean;
  };
}

export interface ImpactPreview {
  requestId: string;
  requestNo: string;
  requesterName: string;
  categoryName: string;
  workflowName: string;
  workflowVersionNumber: number;
  operationLabel: string;
  reasonLabel: string;
  reasonNote: string | null;
  currentStepName: string | null;
  currentStatusName: string | null;
  currentAssigneeLabel: string | null;
  newStepName: string | null;
  newStatusName: string | null;
  newAssigneeLabel: string | null;
  taskToClose: string | null;
  taskToCreate: string | null;
  notificationImpact: string[];
  slaImpact: string;
  warnings: string[];
  rowVersion: number;
  requiresConfirmation: true;
}
