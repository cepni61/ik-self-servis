/**
 * Kategori ve form konfigurasyonu yonetimi (spec 02 - §8, §9).
 *
 * Kategori adlari, routing davranisi (yonetici onayi gerekli mi), SLA,
 * sorumlu rol/ekip ve form alanlari BURADAN yonetilir; kod icinde sabit yok.
 */

import { prisma, type Db } from '../db';
import type { AuthUser } from '../auth/auth-context';
import {
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  FIELD_TYPES,
  HR_ROLE_CODES,
  INSTANCE_STATUS,
} from '../domain/constants';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import { parseConditionGroup } from '../domain/conditions';
import { writeAudit } from './audit.service';
import { getPriorityMap, invalidateCatalogCache } from './catalog.service';
import { parseJsonArray, parseJsonObject } from '../lib/json';

function normalizeCode(input: string, label: string): string {
  const code = (input ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (code.length < 2) throw new ValidationError(`${label} en az 2 karakter olmalıdır.`);
  if (code.length > 50) throw new ValidationError(`${label} en fazla 50 karakter olabilir.`);
  return code;
}

function requireText(value: unknown, label: string, max = 150): string {
  const text = String(value ?? '').trim();
  if (text.length < 2) throw new ValidationError(`${label} zorunludur.`);
  if (text.length > max) throw new ValidationError(`${label} en fazla ${max} karakter olabilir.`);
  return text;
}

// ---------------------------------------------------------------------------
// Kategori listesi (admin)
// ---------------------------------------------------------------------------

export async function listCategoriesForAdmin() {
  const rows = await prisma.requestCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      workflowDefinition: {
        select: { id: true, code: true, name: true, status: true, activeVersionId: true },
      },
      _count: { select: { requests: true, formFields: true } },
    },
  });

  const openCounts = await prisma.request.groupBy({
    by: ['categoryId'],
    where: { instance: { status: INSTANCE_STATUS.RUNNING } },
    _count: { _all: true },
  });
  const openMap = new Map(openCounts.map((c) => [c.categoryId, c._count._all]));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    requiresManagerApproval: r.requiresManagerApproval,
    defaultPriority: r.defaultPriority,
    defaultSlaHours: r.defaultSlaHours,
    ownerRoleCode: r.ownerRoleCode,
    ownerGroupId: r.ownerGroupId,
    requestNoPrefix: r.requestNoPrefix,
    workflow: r.workflowDefinition,
    hasPublishedWorkflow: Boolean(r.workflowDefinition?.activeVersionId),
    requestCount: r._count.requests,
    openRequestCount: openMap.get(r.id) ?? 0,
    formFieldCount: r._count.formFields,
  }));
}

export async function getCategoryForAdmin(categoryId: string) {
  const category = await prisma.requestCategory.findUnique({
    where: { id: categoryId },
    include: {
      workflowDefinition: {
        select: { id: true, code: true, name: true, status: true, activeVersionId: true },
      },
      formFields: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!category) throw new NotFoundError('Kategori bulunamadı.');

  return {
    id: category.id,
    code: category.code,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    requiresManagerApproval: category.requiresManagerApproval,
    defaultPriority: category.defaultPriority,
    defaultSlaHours: category.defaultSlaHours,
    ownerRoleCode: category.ownerRoleCode,
    ownerGroupId: category.ownerGroupId,
    requestNoPrefix: category.requestNoPrefix,
    workflowDefinitionId: category.workflowDefinitionId,
    workflow: category.workflowDefinition,
    formFields: category.formFields.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      isReadOnly: f.isReadOnly,
      isHidden: f.isHidden,
      defaultValue: f.defaultValue,
      helpText: f.helpText,
      placeholder: f.placeholder,
      options: parseJsonArray(f.optionsJson, 'Seçenekler'),
      validation: parseJsonObject(f.validationJson, 'Doğrulama'),
      visibilityConditionJson: f.visibilityConditionJson,
      sortOrder: f.sortOrder,
      isActive: f.isActive,
    })),
  };
}

// ---------------------------------------------------------------------------
// Kategori olustur / guncelle
// ---------------------------------------------------------------------------

export interface CategoryInput {
  code?: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  requiresManagerApproval?: boolean;
  defaultPriority?: string;
  defaultSlaHours?: number | null;
  ownerRoleCode?: string | null;
  ownerGroupId?: string | null;
  requestNoPrefix?: string | null;
  workflowDefinitionId?: string | null;
}

async function validateCategoryInput(input: CategoryInput) {
  if (input.defaultPriority) {
    const priorities = await getPriorityMap();
    if (!priorities.has(input.defaultPriority)) {
      throw new ValidationError('Geçersiz varsayılan öncelik.');
    }
  }
  if (input.defaultSlaHours !== undefined && input.defaultSlaHours !== null) {
    if (input.defaultSlaHours <= 0 || input.defaultSlaHours > 8760) {
      throw new ValidationError('SLA süresi 1-8760 saat aralığında olmalıdır.');
    }
  }
  if (input.ownerRoleCode) {
    const role = await prisma.role.findUnique({ where: { code: input.ownerRoleCode } });
    if (!role) throw new ValidationError('Seçilen sorumlu rol bulunamadı.');
    if (!HR_ROLE_CODES.includes(input.ownerRoleCode as never)) {
      throw new ValidationError(
        'Kategori sorumlusu yalnızca bir İK rolü olabilir (HR_USER veya HR_PROCESS_OWNER).',
      );
    }
  }
  if (input.ownerGroupId) {
    const group = await prisma.userGroup.findUnique({ where: { id: input.ownerGroupId } });
    if (!group) throw new ValidationError('Seçilen ekip bulunamadı.');
  }
  if (input.workflowDefinitionId) {
    const definition = await prisma.workflowDefinition.findUnique({
      where: { id: input.workflowDefinitionId },
    });
    if (!definition) throw new ValidationError('Seçilen iş akışı bulunamadı.');
  }
}

export async function createCategory(user: AuthUser, input: CategoryInput) {
  const code = normalizeCode(input.code ?? '', 'Kategori kodu');
  const name = requireText(input.name, 'Kategori adı');
  await validateCategoryInput(input);

  if (await prisma.requestCategory.findUnique({ where: { code } })) {
    throw new ConflictError(`"${code}" kodlu bir kategori zaten var.`);
  }

  const last = await prisma.requestCategory.findFirst({ orderBy: { sortOrder: 'desc' } });

  const category = await prisma.requestCategory.create({
    data: {
      code,
      name,
      description: input.description?.trim() || null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10,
      requiresManagerApproval: input.requiresManagerApproval ?? false,
      defaultPriority: input.defaultPriority ?? 'MEDIUM',
      defaultSlaHours: input.defaultSlaHours ?? null,
      ownerRoleCode: input.ownerRoleCode ?? null,
      ownerGroupId: input.ownerGroupId ?? null,
      requestNoPrefix: input.requestNoPrefix?.trim().toUpperCase() || null,
      workflowDefinitionId: input.workflowDefinitionId ?? null,
    },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_CREATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    newValue: `${name} (${code})`,
    description: `Yeni talep kategorisi oluşturuldu: ${name}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId: category.id },
  });

  invalidateCatalogCache();
  return { id: category.id, code: category.code };
}

export async function updateCategory(
  user: AuthUser,
  categoryId: string,
  input: CategoryInput,
) {
  const existing = await prisma.requestCategory.findUnique({ where: { id: categoryId } });
  if (!existing) throw new NotFoundError('Kategori bulunamadı.');
  await validateCategoryInput(input);

  const changes: string[] = [];
  const track = (label: string, before: unknown, after: unknown) => {
    if (after !== undefined && String(before ?? '') !== String(after ?? '')) {
      changes.push(`${label}: ${before ?? '-'} → ${after ?? '-'}`);
    }
  };

  track('Ad', existing.name, input.name);
  track('Aktif', existing.isActive, input.isActive);
  track('Yönetici onayı', existing.requiresManagerApproval, input.requiresManagerApproval);
  track('Varsayılan öncelik', existing.defaultPriority, input.defaultPriority);
  track('SLA (saat)', existing.defaultSlaHours, input.defaultSlaHours);
  track('Sorumlu rol', existing.ownerRoleCode, input.ownerRoleCode);
  track('İş akışı', existing.workflowDefinitionId, input.workflowDefinitionId);

  const updated = await prisma.requestCategory.update({
    where: { id: categoryId },
    data: {
      name: input.name !== undefined ? requireText(input.name, 'Kategori adı') : undefined,
      description:
        input.description !== undefined ? input.description?.trim() || null : undefined,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      requiresManagerApproval: input.requiresManagerApproval,
      defaultPriority: input.defaultPriority,
      defaultSlaHours: input.defaultSlaHours,
      ownerRoleCode: input.ownerRoleCode,
      ownerGroupId: input.ownerGroupId,
      requestNoPrefix:
        input.requestNoPrefix !== undefined
          ? input.requestNoPrefix?.trim().toUpperCase() || null
          : undefined,
      workflowDefinitionId: input.workflowDefinitionId,
    },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    description:
      changes.length > 0
        ? `${updated.name} kategorisi güncellendi. ${changes.join(' | ')}`
        : `${updated.name} kategorisi güncellendi.`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId, changes },
  });

  invalidateCatalogCache();
  return { id: updated.id };
}

/**
 * Kategori fiziksel olarak silinmez (talep gecmisi baglantisi kirilmasin).
 * Pasife alinir.
 */
export async function deactivateCategory(user: AuthUser, categoryId: string) {
  const category = await prisma.requestCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new NotFoundError('Kategori bulunamadı.');

  await prisma.requestCategory.update({
    where: { id: categoryId },
    data: { isActive: false },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    oldValue: 'Aktif',
    newValue: 'Pasif',
    description: `${category.name} kategorisi pasife alındı. Mevcut açık talepler etkilenmez.`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId },
  });

  invalidateCatalogCache();
  return { id: categoryId, isActive: false };
}

// ---------------------------------------------------------------------------
// Form alanlari (spec 02 - §9)
// ---------------------------------------------------------------------------

export interface FormFieldInput {
  key?: string;
  label?: string;
  fieldType?: string;
  isRequired?: boolean;
  isReadOnly?: boolean;
  isHidden?: boolean;
  defaultValue?: string | null;
  helpText?: string | null;
  placeholder?: string | null;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  } | null;
  visibilityCondition?: unknown;
  sortOrder?: number;
  isActive?: boolean;
}

function normalizeFieldKey(input: string): string {
  // camelCase benzeri, guvenli anahtar
  const key = (input ?? '').trim().replace(/[^A-Za-z0-9_]/g, '');
  if (key.length < 2) throw new ValidationError('Alan kodu en az 2 karakter olmalıdır.');
  if (key.length > 40) throw new ValidationError('Alan kodu en fazla 40 karakter olabilir.');
  if (/^[0-9]/.test(key)) throw new ValidationError('Alan kodu rakamla başlayamaz.');
  return key;
}

function validateFieldInput(input: FormFieldInput) {
  if (input.fieldType && !FIELD_TYPES.includes(input.fieldType as never)) {
    throw new ValidationError(`Geçersiz alan tipi: ${input.fieldType}`);
  }
  if (
    (input.fieldType === 'DROPDOWN' || input.fieldType === 'MULTI_SELECT') &&
    (!input.options || input.options.length === 0)
  ) {
    throw new ValidationError('Seçim listesi alanları için en az bir seçenek girilmelidir.');
  }
  if (input.options) {
    const values = new Set<string>();
    for (const opt of input.options) {
      const value = String(opt.value ?? '').trim();
      if (!value) throw new ValidationError('Seçenek değeri boş olamaz.');
      if (values.has(value)) {
        throw new ValidationError(`Tekrarlayan seçenek değeri: ${value}`);
      }
      values.add(value);
      if (!String(opt.label ?? '').trim()) {
        throw new ValidationError('Seçenek etiketi boş olamaz.');
      }
    }
  }
  if (input.validation?.pattern) {
    try {
      new RegExp(input.validation.pattern);
    } catch {
      throw new ValidationError('Doğrulama deseni geçerli bir ifade değil.');
    }
  }
  if (input.isRequired && input.isHidden) {
    throw new ValidationError('Gizli bir alan zorunlu olarak işaretlenemez.');
  }

  let visibilityConditionJson: string | null | undefined;
  if (input.visibilityCondition !== undefined) {
    if (input.visibilityCondition === null) {
      visibilityConditionJson = null;
    } else {
      const group = parseConditionGroup(
        typeof input.visibilityCondition === 'string'
          ? input.visibilityCondition
          : JSON.stringify(input.visibilityCondition),
      );
      visibilityConditionJson = group ? JSON.stringify(group) : null;
    }
  }
  return { visibilityConditionJson };
}

export async function addFormField(
  user: AuthUser,
  categoryId: string,
  input: FormFieldInput,
) {
  const category = await prisma.requestCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new NotFoundError('Kategori bulunamadı.');

  const key = normalizeFieldKey(input.key ?? '');
  const label = requireText(input.label, 'Alan etiketi');
  const { visibilityConditionJson } = validateFieldInput(input);

  if (await prisma.categoryFormField.findFirst({ where: { categoryId, key } })) {
    throw new ConflictError(`"${key}" kodlu bir alan bu kategoride zaten var.`);
  }

  const last = await prisma.categoryFormField.findFirst({
    where: { categoryId },
    orderBy: { sortOrder: 'desc' },
  });

  const field = await prisma.categoryFormField.create({
    data: {
      categoryId,
      key,
      label,
      fieldType: input.fieldType ?? 'TEXT',
      isRequired: input.isRequired ?? false,
      isReadOnly: input.isReadOnly ?? false,
      isHidden: input.isHidden ?? false,
      defaultValue: input.defaultValue ?? null,
      helpText: input.helpText?.trim() || null,
      placeholder: input.placeholder?.trim() || null,
      optionsJson: input.options ? JSON.stringify(input.options) : null,
      validationJson: input.validation ? JSON.stringify(input.validation) : null,
      visibilityConditionJson: visibilityConditionJson ?? null,
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10,
      isActive: input.isActive ?? true,
    },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    newValue: `${label} (${key})`,
    description: `${category.name} kategorisine form alanı eklendi: ${label}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId, fieldId: field.id },
  });

  return { id: field.id, key: field.key };
}

export async function updateFormField(
  user: AuthUser,
  fieldId: string,
  input: FormFieldInput,
) {
  const field = await prisma.categoryFormField.findUnique({
    where: { id: fieldId },
    include: { category: { select: { id: true, name: true } } },
  });
  if (!field) throw new NotFoundError('Form alanı bulunamadı.');

  const merged: FormFieldInput = {
    ...input,
    fieldType: input.fieldType ?? field.fieldType,
    options:
      input.options ??
      (parseJsonArray<{ value: string; label: string }>(field.optionsJson, 'Seçenekler') ||
        undefined),
    isRequired: input.isRequired ?? field.isRequired,
    isHidden: input.isHidden ?? field.isHidden,
  };
  const { visibilityConditionJson } = validateFieldInput(merged);

  // Alan kodu degistirilemez: mevcut taleplerin form verisi bu koda bagli.
  if (input.key && normalizeFieldKey(input.key) !== field.key) {
    throw new ConflictError(
      'Alan kodu değiştirilemez; mevcut taleplerin verisi bu koda bağlıdır. Yeni bir alan ekleyip eskisini pasife alabilirsiniz.',
    );
  }

  await prisma.categoryFormField.update({
    where: { id: fieldId },
    data: {
      label: input.label !== undefined ? requireText(input.label, 'Alan etiketi') : undefined,
      fieldType: input.fieldType,
      isRequired: input.isRequired,
      isReadOnly: input.isReadOnly,
      isHidden: input.isHidden,
      defaultValue: input.defaultValue,
      helpText: input.helpText !== undefined ? input.helpText?.trim() || null : undefined,
      placeholder:
        input.placeholder !== undefined ? input.placeholder?.trim() || null : undefined,
      optionsJson: input.options !== undefined ? JSON.stringify(input.options) : undefined,
      validationJson:
        input.validation !== undefined
          ? input.validation
            ? JSON.stringify(input.validation)
            : null
          : undefined,
      visibilityConditionJson:
        input.visibilityCondition !== undefined ? (visibilityConditionJson ?? null) : undefined,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    description: `${field.category.name} kategorisinde form alanı güncellendi: ${field.label}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId: field.categoryId, fieldId },
  });

  return { id: fieldId };
}

/** Kullanimda olan alan pasife alinir; verisi olan alan silinmez. */
export async function removeFormField(user: AuthUser, fieldId: string) {
  const field = await prisma.categoryFormField.findUnique({
    where: { id: fieldId },
    include: { category: { select: { id: true, name: true } } },
  });
  if (!field) throw new NotFoundError('Form alanı bulunamadı.');

  const usedCount = await prisma.request.count({
    where: { categoryId: field.categoryId, formDataJson: { contains: `"${field.key}"` } },
  });

  if (usedCount > 0) {
    await prisma.categoryFormField.update({
      where: { id: fieldId },
      data: { isActive: false },
    });
    await writeAudit(prisma, {
      eventType: AUDIT_EVENT.CATEGORY_UPDATED,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      description: `${field.label} alanı ${usedCount} talepte kullanıldığı için silinmedi, pasife alındı.`,
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: { categoryId: field.categoryId, fieldId, usedCount },
    });
    return { id: fieldId, deactivatedInsteadOfDeleted: true, usedCount };
  }

  await prisma.categoryFormField.delete({ where: { id: fieldId } });
  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.CATEGORY_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    description: `${field.category.name} kategorisinden form alanı silindi: ${field.label}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { categoryId: field.categoryId },
  });
  return { id: fieldId, deactivatedInsteadOfDeleted: false, usedCount: 0 };
}

// ---------------------------------------------------------------------------
// Uygulama ayarlari
// ---------------------------------------------------------------------------

const EDITABLE_SETTING_PREFIXES = ['sla.', 'notification.', 'assignee.', 'attachment.'];

export async function listSettings() {
  return prisma.appSetting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
}

export async function updateSetting(user: AuthUser, key: string, value: string) {
  if (!EDITABLE_SETTING_PREFIXES.some((p) => key.startsWith(p))) {
    throw new ValidationError('Bu ayar arayüzden değiştirilemez.');
  }
  const existing = await prisma.appSetting.findUnique({ where: { key } });
  if (!existing) throw new NotFoundError('Ayar bulunamadı.');

  // Tipe gore basit dogrulama
  if (existing.valueType === 'number' && !Number.isFinite(Number(value))) {
    throw new ValidationError('Bu ayar sayısal bir değer olmalıdır.');
  }
  if (existing.valueType === 'boolean' && !['true', 'false'].includes(value)) {
    throw new ValidationError('Bu ayar true veya false olmalıdır.');
  }
  if (existing.valueType === 'json') {
    try {
      JSON.parse(value);
    } catch {
      throw new ValidationError('Bu ayar geçerli bir JSON olmalıdır.');
    }
  }

  await prisma.appSetting.update({
    where: { key },
    data: { value, updatedById: user.id },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.WORKFLOW_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    fieldName: key,
    oldValue: existing.value,
    newValue: value,
    description: `Sistem ayarı güncellendi: ${key}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
  });

  const { invalidateSettingsCache } = await import('./settings.service');
  invalidateSettingsCache();
  return { key, value };
}
