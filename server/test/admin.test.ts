import './setup'; // env + test veritabani (ilk import olmali)

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

let server: Server;
let baseUrl: string;
const PASSWORD = 'Parola123!';
const tokens = new Map<string, string>();

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

async function api<T = any>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T };
}

async function login(username: string): Promise<string> {
  const cached = tokens.get(username);
  if (cached) return cached;
  const res = await api('POST', '/api/auth/login', { body: { username, password: PASSWORD } });
  assert.equal(res.status, 200, `${username} giris yapamadi`);
  tokens.set(username, res.body.token);
  return res.body.token;
}

async function categoryIdByCode(code: string): Promise<string> {
  return (await prisma.requestCategory.findUniqueOrThrow({ where: { code } })).id;
}

async function createAndSubmit(
  token: string,
  categoryCode: string,
  subject: string,
  formData: Record<string, unknown>,
): Promise<{ id: string; detail: any }> {
  const created = await api('POST', '/api/requests', {
    token,
    body: { categoryId: await categoryIdByCode(categoryCode), subject, formData, submit: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const detail = await api('GET', `/api/requests/${created.body.id}`, { token });
  return { id: created.body.id, detail: detail.body };
}

// ===========================================================================
// Spec 02 - Workflow Configuration
// ===========================================================================

describe('Spec 02-A: Yeni workflow Draft -> Validate -> Publish', () => {
  let definitionId: string;
  let versionId: string;

  it('yeni workflow olusturur (iskelet adimlarla, DRAFT)', async () => {
    const token = await login('sistem.yonetici');
    const res = await api('POST', '/api/admin/workflows', {
      token,
      body: {
        code: 'TEST_AKIS',
        name: 'Test Akışı',
        description: 'Doğrulama testi için',
        useStarterTemplate: true,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    definitionId = res.body.definitionId;
    versionId = res.body.versionId;

    const detail = await api('GET', `/api/admin/workflow-versions/${versionId}`, { token });
    assert.equal(detail.body.status, 'DRAFT');
    assert.equal(detail.body.isEditable, true);
    assert.equal(detail.body.versionNumber, 1);
    assert.equal(detail.body.steps.length, 3);
    assert.equal(detail.body.definition.status, 'DRAFT');
  });

  it('validate temiz gecer ve publish edilir', async () => {
    const token = await login('sistem.yonetici');
    const validation = await api('GET', `/api/admin/workflow-versions/${versionId}/validate`, {
      token,
    });
    assert.equal(validation.body.canPublish, true, JSON.stringify(validation.body.issues));

    const detail = await api('GET', `/api/admin/workflow-versions/${versionId}`, { token });
    const res = await api('POST', `/api/admin/workflow-versions/${versionId}/publish`, {
      token,
      body: { expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.versionNumber, 1);

    const after = await api('GET', `/api/admin/workflow-versions/${versionId}`, { token });
    assert.equal(after.body.status, 'ACTIVE');
    assert.equal(after.body.isEditable, false);
    assert.equal(after.body.definition.status, 'ACTIVE');
    assert.equal(after.body.definition.activeVersionId, versionId);
  });

  it('yayinlanmis surum DOGRUDAN degistirilemez', async () => {
    const token = await login('sistem.yonetici');
    const detail = await api('GET', `/api/admin/workflow-versions/${versionId}`, { token });

    const addStep = await api('POST', `/api/admin/workflow-versions/${versionId}/steps`, {
      token,
      body: {
        code: 'YASAK_ADIM',
        name: 'Yasak Adım',
        type: 'TASK',
        assigneeType: 'HR_USER',
        statusCode: 'IN_PROGRESS',
        expectedRowVersion: detail.body.rowVersion,
      },
    });
    assert.equal(addStep.status, 409);
    assert.match(addStep.body.error.message, /Revizyon Oluştur/);

    const patchHeader = await api('PATCH', `/api/admin/workflow-versions/${versionId}`, {
      token,
      body: { changeDescription: 'yasak', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(patchHeader.status, 409);
  });

  it('Spec 02-D: sorumlusu olmayan approval adimi kabul edilmez', async () => {
    const token = await login('sistem.yonetici');
    const revision = await api('POST', `/api/admin/workflows/${definitionId}/revisions`, {
      token,
      body: {},
    });
    assert.equal(revision.status, 201);
    const draftId = revision.body.versionId;
    const draft = await api('GET', `/api/admin/workflow-versions/${draftId}`, { token });

    const res = await api('POST', `/api/admin/workflow-versions/${draftId}/steps`, {
      token,
      body: {
        code: 'ONAY_SORUMLUSUZ',
        name: 'Sorumlusuz Onay',
        type: 'APPROVAL',
        assigneeType: 'ROLE', // rol secilmedi
        statusCode: 'PENDING_MANAGER_APPROVAL',
        expectedRowVersion: draft.body.rowVersion,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /rol seçilmelidir/i);

    // Temizlik: taslagi sil
    await api('DELETE', `/api/admin/workflow-versions/${draftId}`, { token });
  });

  it('bitis adimi olmayan surum publish edilemez', async () => {
    const token = await login('sistem.yonetici');
    const revision = await api('POST', `/api/admin/workflows/${definitionId}/revisions`, {
      token,
      body: { changeDescription: 'Bitiş adımı silinerek doğrulama testi' },
    });
    const draftId = revision.body.versionId;
    let draft = await api('GET', `/api/admin/workflow-versions/${draftId}`, { token });

    const endStep = draft.body.steps.find((s: any) => s.type === 'END');
    const del = await api('DELETE', `/api/admin/workflow-steps/${endStep.id}`, {
      token,
      body: { expectedRowVersion: draft.body.rowVersion },
    });
    assert.equal(del.status, 200, JSON.stringify(del.body));

    const validation = await api('GET', `/api/admin/workflow-versions/${draftId}/validate`, {
      token,
    });
    assert.equal(validation.body.canPublish, false);
    const codes = validation.body.issues.map((i: any) => i.code);
    assert.ok(codes.includes('NO_END'), `Beklenen NO_END, gelen: ${codes.join(',')}`);

    draft = await api('GET', `/api/admin/workflow-versions/${draftId}`, { token });
    const publish = await api('POST', `/api/admin/workflow-versions/${draftId}/publish`, {
      token,
      body: { expectedRowVersion: draft.body.rowVersion },
    });
    assert.equal(publish.status, 422);
    assert.equal(publish.body.error.code, 'WORKFLOW_CONFIG_ERROR');
    assert.ok(publish.body.error.details.issues.length > 0);

    // Aktif surum hala v1 ve bozulmamis olmali
    const definition = await prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
    });
    assert.equal(definition.activeVersionId, versionId);

    await api('DELETE', `/api/admin/workflow-versions/${draftId}`, { token });
  });

  it('ayni anda ikinci taslak surum olusturulamaz', async () => {
    const token = await login('sistem.yonetici');
    const first = await api('POST', `/api/admin/workflows/${definitionId}/revisions`, {
      token,
      body: {},
    });
    assert.equal(first.status, 201);

    const second = await api('POST', `/api/admin/workflows/${definitionId}/revisions`, {
      token,
      body: {},
    });
    assert.equal(second.status, 409);
    assert.match(second.body.error.message, /taslak/i);

    await api('DELETE', `/api/admin/workflow-versions/${first.body.versionId}`, { token });
  });
});

describe('Spec 02-B/C: Versiyonlama - acik kayitlar eski surumde kalir', () => {
  let openRequestId: string;
  let v1Id: string;
  let v2Id: string;
  let definitionId: string;

  it('v1 uzerinde acik bir talep olusturulur', async () => {
    const token = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      token,
      'PERSONEL_KART',
      'Versiyon testi - açık talep',
      { kartTipi: 'YENI' },
    );
    openRequestId = id;

    assert.equal(detail.workflow.versionNumber, 1);
    assert.equal(detail.currentStep.stepName, 'Yönetici Onayı');
    v1Id = detail.workflow.versionId;
    definitionId = (
      await prisma.workflowInstance.findUniqueOrThrow({ where: { requestId: id } })
    ).definitionId;
  });

  it('revizyon olusturulur: v2 Draft, v1 degismeden Active kalir', async () => {
    const token = await login('sistem.yonetici');
    const res = await api('POST', `/api/admin/workflows/${definitionId}/revisions`, {
      token,
      body: { changeDescription: 'İK adım adı güncellendi' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.versionNumber, 2);
    v2Id = res.body.versionId;

    const v1 = await prisma.workflowVersion.findUniqueOrThrow({ where: { id: v1Id } });
    assert.equal(v1.status, 'ACTIVE', 'v1 hala ACTIVE olmali');

    const definition = await prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
    });
    assert.equal(definition.activeVersionId, v1Id, 'Aktif surum hala v1');

    // v2 icerigi v1 ile ayni kopyalanmis olmali
    const v2 = await api('GET', `/api/admin/workflow-versions/${v2Id}`, { token });
    assert.equal(v2.body.steps.length, 4);
    assert.equal(v2.body.status, 'DRAFT');

    // Aksiyon hedefleri yeni surumun adimlarina remap edilmis olmali
    const v2StepIds = new Set(v2.body.steps.map((s: any) => s.id));
    for (const step of v2.body.steps) {
      for (const action of step.actions) {
        if (action.targetStepId) {
          assert.ok(
            v2StepIds.has(action.targetStepId),
            'Hedef adim yeni surumun adimlarina baglanmali',
          );
        }
      }
    }
  });

  it('v2 duzenlenir ve yayinlanir', async () => {
    const token = await login('sistem.yonetici');
    let v2 = await api('GET', `/api/admin/workflow-versions/${v2Id}`, { token });
    const hrStep = v2.body.steps.find((s: any) => s.code === 'HR_KONTROL');

    const patch = await api('PATCH', `/api/admin/workflow-steps/${hrStep.id}`, {
      token,
      body: {
        name: 'İK Kontrolü (v2)',
        slaHours: 96,
        expectedRowVersion: v2.body.rowVersion,
      },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    v2 = await api('GET', `/api/admin/workflow-versions/${v2Id}`, { token });
    const publish = await api('POST', `/api/admin/workflow-versions/${v2Id}/publish`, {
      token,
      body: { expectedRowVersion: v2.body.rowVersion },
    });
    assert.equal(publish.status, 200, JSON.stringify(publish.body));
    assert.equal(publish.body.versionNumber, 2);
    assert.equal(publish.body.previousVersionNumber, 1);
    assert.ok(
      publish.body.runningInstancesOnPreviousVersion >= 1,
      'v1 uzerinde acik kayit sayisi bildirilmeli',
    );

    const v1 = await prisma.workflowVersion.findUniqueOrThrow({ where: { id: v1Id } });
    assert.equal(v1.status, 'SUPERSEDED');
  });

  it('Spec 02-C: v1 ile baslamis acik kayit v1 uzerinde devam eder', async () => {
    const token = await login('mehmet.ozturk');
    const detail = await api('GET', `/api/requests/${openRequestId}`, { token });

    assert.equal(detail.body.workflow.versionNumber, 1, 'Acik kayit v1 de kalmali');
    assert.equal(detail.body.currentStep.stepName, 'Yönetici Onayı');

    // v1 adim adlari degismemis olmali
    const hrStep = detail.body.progress.find((s: any) => s.stepCode === 'HR_KONTROL');
    assert.equal(hrStep.stepName, 'İnsan Kaynakları Kontrolü', 'v1 adim adi degismemeli');

    // Ve kayit v1 uzerinden sorunsuz ilerlemeli
    const managerToken = await login('ahmet.yilmaz');
    const approve = await api('POST', `/api/requests/${openRequestId}/actions`, {
      token: managerToken,
      body: { actionCode: 'ONAYLA', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));

    const after = await api('GET', `/api/requests/${openRequestId}`, { token });
    assert.equal(after.body.workflow.versionNumber, 1);
    assert.equal(after.body.currentStep.stepName, 'İnsan Kaynakları Kontrolü');
  });

  it('yeni talepler v2 kullanir', async () => {
    const token = await login('ayse.celik');
    const { detail } = await createAndSubmit(
      token,
      'PERSONEL_KART',
      'Versiyon testi - yeni talep',
      { kartTipi: 'YENI' },
    );
    assert.equal(detail.workflow.versionNumber, 2);

    const hrStep = detail.progress.find((s: any) => s.stepCode === 'HR_KONTROL');
    assert.equal(hrStep.stepName, 'İK Kontrolü (v2)', 'Yeni talep v2 adim adini kullanmali');
  });
});

// ===========================================================================
// Spec 03 - Admin Live Operations
// ===========================================================================

describe('Spec 03: Canli surecler ekrani', () => {
  it('admin calisan kayitlari listeler', async () => {
    const token = await login('sistem.yonetici');
    const res = await api('GET', '/api/admin/live/instances', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.total > 0);

    const item = res.body.items[0];
    for (const field of [
      'requestId',
      'requestNo',
      'requester',
      'category',
      'workflow',
      'workflowVersion',
      'currentStepName',
      'currentStatus',
      'currentAssigneeLabel',
      'startedAt',
      'slaStatus',
      'rowVersion',
    ]) {
      assert.ok(field in item, `Kolon eksik: ${field}`);
    }
  });

  it('canli kayit detayi mudahale icin gerekli bilgiyi verir', async () => {
    const employeeToken = await login('can.arslan');
    const { id } = await createAndSubmit(employeeToken, 'IZIN_IPTAL', 'İzin iptali', {
      izinBaslangic: '2026-09-01',
      izinBitis: '2026-09-05',
      iptalGerekcesi: 'Proje teslimi',
    });

    const token = await login('sistem.yonetici');
    const res = await api('GET', `/api/admin/live/requests/${id}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.ok(res.body.request.requestNo);
    assert.ok(res.body.workflow.versionNumber);
    assert.ok(res.body.currentStep);
    assert.equal(res.body.currentStep.name, 'Yönetici Onayı');
    assert.ok(res.body.nextExpectedStep, 'Sonraki beklenen adim gorunmeli');
    assert.ok(Array.isArray(res.body.timeline));
    assert.ok(Array.isArray(res.body.auditTrail));
    assert.ok(Array.isArray(res.body.approvalHistory));
    assert.ok(res.body.overrideOptions.moveTargets.length > 0);
    assert.equal(res.body.overrideOptions.canOverride, true);
  });
});

describe('Spec 03-A: Sorumlu Degistir (yonetici ayrilmis)', () => {
  let requestId: string;
  let rowVersion: number;

  before(async () => {
    const token = await login('deniz.koc');
    const { id, detail } = await createAndSubmit(token, 'KART_YETKISI', 'Laboratuvar yetkisi', {
      yetkiAlanlari: ['LABORATUVAR'],
      baslangicTarihi: '2026-09-01',
      suresizMi: true,
    });
    requestId = id;
    rowVersion = detail.rowVersion;
    assert.equal(detail.whoHasIt, 'Fatma Aydın');
  });

  it('neden secilmeden mudahale yapilamaz', async () => {
    const token = await login('sistem.yonetici');
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: { overrideType: 'REASSIGN', expectedRowVersion: rowVersion },
    });
    assert.equal(res.status, 400);
  });

  it('"Diger" nedeninde aciklama zorunludur', async () => {
    const token = await login('sistem.yonetici');
    const manager = await prisma.user.findUniqueOrThrow({ where: { username: 'zeynep.kaya' } });
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'REASSIGN',
        reasonCode: 'OTHER',
        targetAssigneeId: manager.id,
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /açıklama zorunludur/i);
  });

  it('Impact Preview hicbir degisiklik yapmaz ve etkiyi gosterir', async () => {
    const token = await login('sistem.yonetici');
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'zeynep.kaya' } });

    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'REASSIGN',
        reasonCode: 'USER_LEFT',
        targetAssigneeId: target.id,
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal(res.body.operationLabel, 'Sorumlu Değiştir');
    assert.equal(res.body.reasonLabel, 'Kullanici sistemden ayrildi');
    assert.equal(res.body.currentStepName, 'Yönetici Onayı');
    assert.equal(res.body.currentAssigneeLabel, 'Fatma Aydın');
    assert.equal(res.body.newAssigneeLabel, 'Zeynep Kaya');
    assert.equal(res.body.newStepName, 'Yönetici Onayı', 'Adim degismemeli');
    assert.match(res.body.slaImpact, /kesintisiz devam/);
    assert.ok(res.body.notificationImpact.length > 0);
    assert.equal(res.body.requiresConfirmation, true);

    // Preview veriyi degistirmedi
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(fresh.rowVersion, rowVersion, 'Preview rowVersion degistirmemeli');
    assert.equal(fresh.currentAssigneeLabel, 'Fatma Aydın');
    assert.equal(
      await prisma.adminOverride.count({ where: { requestId } }),
      0,
      'Preview override kaydi olusturmamali',
    );
  });

  it('confirmed olmadan uygulanamaz', async () => {
    const token = await login('sistem.yonetici');
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'zeynep.kaya' } });
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override`, {
      token,
      body: {
        overrideType: 'REASSIGN',
        reasonCode: 'USER_LEFT',
        targetAssigneeId: target.id,
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /onay/i);
  });

  it('onaydan sonra uygulanir; audit ve timeline kaydi olusur', async () => {
    const token = await login('sistem.yonetici');
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'zeynep.kaya' } });

    const res = await api('POST', `/api/admin/live/requests/${requestId}/override`, {
      token,
      body: {
        overrideType: 'REASSIGN',
        reasonCode: 'USER_LEFT',
        reasonNote: 'Yönetici kurumdan ayrıldı, süreç sahibine devredildi.',
        targetAssigneeId: target.id,
        expectedRowVersion: rowVersion,
        confirmed: true,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.currentAssigneeLabel, 'Zeynep Kaya');
    assert.equal(res.body.rowVersion, rowVersion + 1);

    // AdminOverride kaydi tam
    const override = await prisma.adminOverride.findFirstOrThrow({
      where: { requestId },
      include: { adminUser: true },
    });
    assert.equal(override.overrideType, 'REASSIGN');
    assert.equal(override.reasonCode, 'USER_LEFT');
    assert.ok(override.reasonNote);
    assert.equal(override.fromStepName, 'Yönetici Onayı');
    assert.equal(override.toStepName, 'Yönetici Onayı');
    assert.equal(override.fromStatusCode, 'PENDING_MANAGER_APPROVAL');
    assert.equal(override.toAssigneeId, target.id);
    assert.ok(override.fromAssigneeId);
    assert.ok(override.workflowVersionId);
    assert.ok(override.workflowVersionNumber);
    assert.equal(override.adminUser.username, 'sistem.yonetici');

    // Audit: teknik (ADMIN) + kullanici dostu (USER)
    const adminAudit = await prisma.auditEvent.findFirst({
      where: { requestId, eventType: 'ADMIN_OVERRIDE', visibility: 'ADMIN' },
    });
    assert.ok(adminAudit, 'Teknik audit kaydi olmali');
    assert.ok(adminAudit!.oldValue && adminAudit!.newValue);

    const userAudit = await prisma.auditEvent.findFirst({
      where: { requestId, eventType: 'ADMIN_OVERRIDE', visibility: 'USER' },
    });
    assert.ok(userAudit, 'Kullanici timeline kaydi olmali');
    assert.match(userAudit!.description!, /sistem yöneticisi/i);

    // Calisan timeline'inda anlasilir sekilde gorunur, teknik detay gorunmez
    const employeeToken = await login('deniz.koc');
    const detail = await api('GET', `/api/requests/${requestId}`, { token: employeeToken });
    const overrideEntries = detail.body.timeline.filter(
      (t: any) => t.eventType === 'ADMIN_OVERRIDE',
    );
    assert.equal(overrideEntries.length, 1, 'Calisan yalnizca bir mudahale kaydi gormeli');
    assert.equal(overrideEntries[0].visibility, 'USER');

    // Yeni sorumlu artik islem yapabilir
    const newAssigneeToken = await login('zeynep.kaya');
    const canAct = await api('GET', `/api/requests/${requestId}`, { token: newAssigneeToken });
    assert.ok(canAct.body.availableActions.some((a: any) => a.code === 'ONAYLA'));
  });

  it('Spec 03-C: bayat rowVersion ile mudahale engellenir', async () => {
    const token = await login('sistem.yonetici');
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'elif.demir' } });

    const res = await api('POST', `/api/admin/live/requests/${requestId}/override`, {
      token,
      body: {
        overrideType: 'REASSIGN',
        reasonCode: 'ORG_CHANGE',
        targetAssigneeId: target.id,
        expectedRowVersion: rowVersion, // artik guncel degil
        confirmed: true,
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'STALE_DATA');

    // Sorumlu degismedi
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(fresh.currentAssigneeLabel, 'Zeynep Kaya');
  });
});

describe('Spec 03-B: Adim Atlat (yanlis routing)', () => {
  it('mevcut adim atlanir, sonraki adim baslar, SLA yeniden baslar', async () => {
    const employeeToken = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      employeeToken,
      'STERIL_BILEKLIK',
      'Steril alan bileklik',
      { alanKodu: 'STR-B1', bileklikAdedi: 2, gerekcesi: 'Yeni görev' },
    );
    assert.equal(detail.currentStep.stepName, 'Yönetici Onayı');

    const token = await login('sistem.yonetici');

    // Preview
    const preview = await api('POST', `/api/admin/live/requests/${id}/override/preview`, {
      token,
      body: {
        overrideType: 'SKIP_STEP',
        reasonCode: 'WRONG_ROUTING',
        expectedRowVersion: detail.rowVersion,
      },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.operationLabel, 'Adımı Atla');
    assert.equal(preview.body.currentStepName, 'Yönetici Onayı');
    assert.match(preview.body.newStepName, /Kontrol/);
    assert.equal(preview.body.newStatusName, 'İnsan Kaynakları Kontrolünde');
    assert.match(preview.body.taskToClose, /Yönetici Onayı/);
    assert.ok(preview.body.taskToCreate);
    assert.match(preview.body.slaImpact, /başlatılacak/);

    // Uygula
    const apply = await api('POST', `/api/admin/live/requests/${id}/override`, {
      token,
      body: {
        overrideType: 'SKIP_STEP',
        reasonCode: 'WRONG_ROUTING',
        reasonNote: 'Bu kategori için yönetici onayı gerekmiyordu.',
        expectedRowVersion: detail.rowVersion,
        confirmed: true,
      },
    });
    assert.equal(apply.status, 200, JSON.stringify(apply.body));
    assert.equal(apply.body.statusCode, 'HR_REVIEW');

    // Atlanan adim SKIPPED + ADMIN_OVERRIDE nedeni ile isaretli
    const instance = await prisma.workflowInstance.findUniqueOrThrow({
      where: { requestId: id },
      include: { stepInstances: true },
    });
    const skipped = instance.stepInstances.find((s) => s.stepCode === 'YONETICI_ONAYI');
    assert.equal(skipped!.status, 'SKIPPED');
    assert.equal(skipped!.skipReason, 'ADMIN_OVERRIDE');

    const active = instance.stepInstances.find((s) => s.isCurrent);
    assert.equal(active!.stepCode, 'HR_KONTROL');
    assert.ok(active!.dueAt, 'Yeni adim SLA suresi baslatilmali');
    assert.ok(active!.startedAt);

    // IK artik islem yapabiliyor
    const hrToken = await login('elif.demir');
    const hrView = await api('GET', `/api/requests/${id}`, { token: hrToken });
    assert.ok(hrView.body.availableActions.some((a: any) => a.code === 'TAMAMLA'));
  });
});

describe('Spec 03: Hedef Adima Tasi', () => {
  it('kayit geriye tasinir, gecmis silinmez, yeni adim ornegi olusur', async () => {
    const employeeToken = await login('ayse.celik');
    const { id, detail } = await createAndSubmit(
      employeeToken,
      'PERSONEL_KART',
      'Geriye taşıma testi',
      { kartTipi: 'YENI' },
    );

    // Yonetici onaylar -> IK adimina gecer
    const managerToken = await login('ahmet.yilmaz');
    const approve = await api('POST', `/api/requests/${id}/actions`, {
      token: managerToken,
      body: { actionCode: 'ONAYLA', expectedRowVersion: detail.rowVersion },
    });
    assert.equal(approve.status, 200);

    const token = await login('sistem.yonetici');
    const live = await api('GET', `/api/admin/live/requests/${id}`, { token });
    const managerTarget = live.body.overrideOptions.moveTargets.find(
      (t: any) => t.code === 'YONETICI_ONAYI',
    );
    assert.ok(managerTarget, 'Yonetici onayi adimi hedef olarak secilebilmeli');
    assert.equal(managerTarget.isRevisit, true, 'Tamamlanmis adim yeniden ziyaret olarak isaretli');

    const preview = await api('POST', `/api/admin/live/requests/${id}/override/preview`, {
      token,
      body: {
        overrideType: 'MOVE_TO_STEP',
        reasonCode: 'PROCESS_CORRECTION',
        targetStepId: managerTarget.stepId,
        expectedRowVersion: live.body.request.rowVersion,
      },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(
      preview.body.warnings.some((w: string) => /geriye taşınıyor/i.test(w)),
      'Geriye tasima uyarisi gosterilmeli',
    );

    const apply = await api('POST', `/api/admin/live/requests/${id}/override`, {
      token,
      body: {
        overrideType: 'MOVE_TO_STEP',
        reasonCode: 'PROCESS_CORRECTION',
        reasonNote: 'Onay hatalı verildi, tekrar değerlendirilmeli.',
        targetStepId: managerTarget.stepId,
        expectedRowVersion: live.body.request.rowVersion,
        confirmed: true,
      },
    });
    assert.equal(apply.status, 200, JSON.stringify(apply.body));
    assert.equal(apply.body.statusCode, 'PENDING_MANAGER_APPROVAL');

    // Gecmis korunmus: YONETICI_ONAYI icin iki adim ornegi var
    const instance = await prisma.workflowInstance.findUniqueOrThrow({
      where: { requestId: id },
      include: { stepInstances: { orderBy: { createdAt: 'asc' } } },
    });
    const managerSteps = instance.stepInstances.filter((s) => s.stepCode === 'YONETICI_ONAYI');
    assert.equal(managerSteps.length, 2, 'Yeni bir adim ornegi olusmali');
    assert.equal(managerSteps[0].status, 'COMPLETED', 'Ilk onay kaydi korunmali');
    assert.equal(managerSteps[0].resultActionCode, 'ONAYLA');
    assert.equal(managerSteps[1].status, 'ACTIVE');

    // Onceki onay gecmisi hala gorunur
    const detailAfter = await api('GET', `/api/requests/${id}`, { token: employeeToken });
    assert.ok(
      detailAfter.body.approvalHistory.some((h: any) => h.actionKind === 'APPROVE'),
      'Onay gecmisi silinmemeli',
    );
  });
});

describe('Spec 03-D: Serbest statu girilemez', () => {
  let requestId: string;
  let rowVersion: number;

  before(async () => {
    const token = await login('can.arslan');
    const { id, detail } = await createAndSubmit(token, 'BORDRO', 'Statü testi', {
      donem: '2026-08',
      teslimFormat: 'PDF',
    });
    requestId = id;
    rowVersion = detail.rowVersion;
  });

  it('tanimsiz statu kodu reddedilir', async () => {
    const token = await login('sistem.yonetici');
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'CHANGE_STATUS',
        reasonCode: 'TECHNICAL_ERROR',
        targetStatusCode: 'HER_NE_ISTERSEM',
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Tanımsız durum/i);
  });

  it('override izni olmayan tanimli statu de reddedilir', async () => {
    const token = await login('sistem.yonetici');
    // SUBMITTED tanimli ama allowAdminOverride=false
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'CHANGE_STATUS',
        reasonCode: 'TECHNICAL_ERROR',
        targetStatusCode: 'SUBMITTED',
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /müdahalesi ile seçilemez/i);
  });

  it('izin verilen statu degisikligi uygulanir', async () => {
    const token = await login('sistem.yonetici');
    const preview = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'CHANGE_STATUS',
        reasonCode: 'PROCESS_CORRECTION',
        targetStatusCode: 'IN_PROGRESS',
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.newStatusName, 'İşleme Alındı');
    assert.match(preview.body.slaImpact, /kesintisiz devam/);

    const apply = await api('POST', `/api/admin/live/requests/${requestId}/override`, {
      token,
      body: {
        overrideType: 'CHANGE_STATUS',
        reasonCode: 'PROCESS_CORRECTION',
        reasonNote: 'İşlem başlatıldı, durum güncellendi.',
        targetStatusCode: 'IN_PROGRESS',
        expectedRowVersion: rowVersion,
        confirmed: true,
      },
    });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.statusCode, 'IN_PROGRESS');

    // Adim ve sorumlu degismedi
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(fresh.currentStepCode, 'HR_KONTROL');
    assert.equal(fresh.currentAssigneeLabel, 'İnsan Kaynakları');

    // IK hala islem yapabiliyor
    const hrToken = await login('elif.demir');
    const view = await api('GET', `/api/requests/${requestId}`, { token: hrToken });
    assert.ok(view.body.availableActions.some((a: any) => a.code === 'TAMAMLA'));
  });

  it('kapanmis kayda mudahale edilemez', async () => {
    const hrToken = await login('elif.demir');
    const view = await api('GET', `/api/requests/${requestId}`, { token: hrToken });
    const complete = await api('POST', `/api/requests/${requestId}/actions`, {
      token: hrToken,
      body: { actionCode: 'TAMAMLA', expectedRowVersion: view.body.rowVersion },
    });
    assert.equal(complete.status, 200);

    const token = await login('sistem.yonetici');
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    const res = await api('POST', `/api/admin/live/requests/${requestId}/override/preview`, {
      token,
      body: {
        overrideType: 'CHANGE_STATUS',
        reasonCode: 'PROCESS_CORRECTION',
        targetStatusCode: 'IN_PROGRESS',
        expectedRowVersion: fresh.rowVersion,
      },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /Kapanmış/i);
  });
});

// ===========================================================================
// Raporlama
// ===========================================================================

describe('Raporlama', () => {
  it('ozet metrikleri doner', async () => {
    const token = await login('zeynep.kaya');
    const res = await api('GET', '/api/catalog/reports/summary', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.totals.total > 0);
    assert.ok('open' in res.body.totals);
    assert.ok('completed' in res.body.totals);
    assert.ok('rejected' in res.body.totals);
    assert.ok(Array.isArray(res.body.byCategory));
    assert.ok(Array.isArray(res.body.byStatus));
    assert.ok('averageCompletionHours' in res.body.durations);
    assert.ok('compliancePercent' in res.body.sla);
  });

  it('calisan yalnizca kendi kayitlarinin metrigini gorur', async () => {
    const employeeToken = await login('deniz.koc');
    const hrToken = await login('zeynep.kaya');

    const employeeReport = await api('GET', '/api/catalog/reports/summary', {
      token: employeeToken,
    });
    const hrReport = await api('GET', '/api/catalog/reports/summary', { token: hrToken });

    // Calisan yalnizca kendi taleplerini sayar; IK surec sahibi IK'ya ait tum
    // kategorileri gorur -> raporu her zaman daha genis olmalidir.
    assert.ok(
      employeeReport.body.totals.total > 0,
      'Calisan kendi taleplerini gormeli',
    );
    assert.ok(
      hrReport.body.totals.total > employeeReport.body.totals.total,
      `IK raporu (${hrReport.body.totals.total}) calisan raporundan (${employeeReport.body.totals.total}) genis olmali`,
    );
  });

  it('CSV export calisir', async () => {
    const token = await login('zeynep.kaya');
    const res = await fetch(`${baseUrl}/api/catalog/reports/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    const text = await res.text();
    assert.match(text, /Talep No;Kategori/);
  });
});
