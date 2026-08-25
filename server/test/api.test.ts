import './setup'; // env + test veritabani (ilk import olmali)

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

// ---------------------------------------------------------------------------
// Test altyapisi
// ---------------------------------------------------------------------------

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

interface ApiResponse<T = any> {
  status: number;
  body: T;
}

async function api<T = any>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...options.headers };
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
  const res = await api('POST', '/api/auth/login', {
    body: { username, password: PASSWORD },
  });
  assert.equal(res.status, 200, `${username} giris yapamadi: ${JSON.stringify(res.body)}`);
  const token = res.body.token as string;
  tokens.set(username, token);
  return token;
}

async function categoryIdByCode(code: string): Promise<string> {
  const category = await prisma.requestCategory.findUniqueOrThrow({ where: { code } });
  return category.id;
}

/** Talep olustur + gonder; detay dondur. */
async function createAndSubmit(
  token: string,
  categoryCode: string,
  subject: string,
  formData: Record<string, unknown>,
): Promise<{ id: string; detail: any }> {
  const created = await api('POST', '/api/requests', {
    token,
    body: {
      categoryId: await categoryIdByCode(categoryCode),
      subject,
      description: 'Test talebi',
      formData,
      submit: true,
    },
  });
  assert.equal(created.status, 201, `Talep olusturulamadi: ${JSON.stringify(created.body)}`);
  const id = created.body.id as string;
  const detail = await api('GET', `/api/requests/${id}`, { token });
  assert.equal(detail.status, 200);
  return { id, detail: detail.body };
}

const BORDRO_FORM = { donem: '2026-07', teslimFormat: 'PDF' };
const KART_FORM = { kartTipi: 'YENI' };

// ---------------------------------------------------------------------------

describe('Altyapi', () => {
  it('health endpoint calisiyor', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('token olmadan talep listesine erisilemez', async () => {
    const res = await api('GET', '/api/requests');
    assert.equal(res.status, 401);
  });

  it('gecersiz sifre ile giris reddedilir ve sebep sizdirilmaz', async () => {
    const res = await api('POST', '/api/auth/login', {
      body: { username: 'mehmet.ozturk', password: 'yanlis' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Kullanıcı adı veya şifre hatalı.');
  });

  it('/me profil ve birinci yonetici bilgisini dondurur', async () => {
    const token = await login('mehmet.ozturk');
    const res = await api('GET', '/api/auth/me', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.displayName, 'Mehmet Öztürk');
    assert.equal(res.body.manager.displayName, 'Ahmet Yılmaz');
    assert.deepEqual(res.body.roles, ['EMPLOYEE']);
  });
});

// ---------------------------------------------------------------------------
// Spec 01 - §17 Kabul Senaryolari
// ---------------------------------------------------------------------------

describe('Senaryo B: Bordro Talebi (Employee -> HR -> Complete)', () => {
  let requestId: string;

  it('yonetici onayi adimini atlar, dogrudan IK kontrolune duser', async () => {
    const token = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      token,
      'BORDRO',
      'Temmuz 2026 bordro talebi',
      BORDRO_FORM,
    );
    requestId = id;

    assert.equal(detail.status.code, 'HR_REVIEW');
    assert.equal(detail.whoHasIt, 'İnsan Kaynakları');
    assert.equal(detail.currentStep.stepCode, 'HR_KONTROL');

    // Yonetici onayi adimi kosul saglanmadigi icin atlanmis olmali
    const managerStep = detail.progress.find((s: any) => s.stepCode === 'YONETICI_ONAYI');
    assert.equal(managerStep.status, 'SKIPPED');
    assert.equal(managerStep.skipReason, 'CONDITION_NOT_MET');
    assert.equal(managerStep.phase, 'skipped');

    // Sonraki beklenen adim gorunur olmali
    assert.equal(detail.nextExpectedStep.stepName, 'Tamamlandı');
  });

  it('talep sahibi islem yapamaz (adim IK havuzunda)', async () => {
    const token = await login('mehmet.ozturk');
    const detail = await api('GET', `/api/requests/${requestId}`, { token });
    assert.deepEqual(detail.body.availableActions, []);

    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: { actionCode: 'TAMAMLA', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(res.status, 403);
  });

  it('IK kullanicisi tamamlar ve talep kapanir', async () => {
    const token = await login('elif.demir');
    const detail = await api('GET', `/api/requests/${requestId}`, { token });
    assert.equal(detail.status, 200);

    const actionCodes = detail.body.availableActions.map((a: any) => a.code);
    assert.ok(actionCodes.includes('TAMAMLA'));
    assert.ok(actionCodes.includes('REDDET'));

    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: { actionCode: 'TAMAMLA', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.statusCode, 'COMPLETED');

    const after = await api('GET', `/api/requests/${requestId}`, { token });
    assert.equal(after.body.status.code, 'COMPLETED');
    assert.equal(after.body.whoHasIt, null);
    assert.ok(after.body.completedAt);
    assert.deepEqual(after.body.availableActions, []);
  });
});

describe('Senaryo A: Personel Kart Talebi (Employee -> Manager -> HR -> Complete)', () => {
  let requestId: string;

  it('yonetici onayina duser ve sorumlusu birinci yonetici olur', async () => {
    const token = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      token,
      'PERSONEL_KART',
      'Yeni personel kartı talebi',
      KART_FORM,
    );
    requestId = id;

    assert.equal(detail.status.code, 'PENDING_MANAGER_APPROVAL');
    assert.equal(detail.whoHasIt, 'Ahmet Yılmaz');
    assert.equal(detail.currentStep.stepCode, 'YONETICI_ONAYI');
    assert.equal(detail.nextExpectedStep.stepName, 'İnsan Kaynakları Kontrolü');
    assert.ok(detail.sla.dueAt, 'Yonetici onayi adiminda SLA tanimli olmali');
  });

  it('Senaryo C: baska bir yonetici bu talebi onaylayamaz', async () => {
    const managerToken = await login('fatma.aydin');
    const employeeToken = await login('mehmet.ozturk');
    const detail = await api('GET', `/api/requests/${requestId}`, { token: employeeToken });

    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token: managerToken,
      body: { actionCode: 'ONAYLA', expectedRowVersion: detail.body.rowVersion },
    });
    // Baska yoneticinin gorme yetkisi de yok -> 404, islem yetkisi -> 403
    assert.ok(
      res.status === 403 || res.status === 404,
      `Beklenen 403/404, gelen ${res.status}`,
    );

    // Talep hala yonetici onayinda
    const fresh = await api('GET', `/api/requests/${requestId}`, { token: employeeToken });
    assert.equal(fresh.body.status.code, 'PENDING_MANAGER_APPROVAL');
  });

  it('yonetici onaylar, talep IK kontrolune gecer', async () => {
    const token = await login('ahmet.yilmaz');
    const detail = await api('GET', `/api/requests/${requestId}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.whoHasIt, 'Ahmet Yılmaz');

    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: { actionCode: 'ONAYLA', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.statusCode, 'HR_REVIEW');

    const after = await api('GET', `/api/requests/${requestId}`, { token });
    assert.equal(after.body.whoHasIt, 'İnsan Kaynakları');

    const managerStep = after.body.progress.find((s: any) => s.stepCode === 'YONETICI_ONAYI');
    assert.equal(managerStep.status, 'COMPLETED');
    assert.equal(managerStep.resultActionCode, 'ONAYLA');
    assert.equal(managerStep.phase, 'past');

    // Onay gecmisi
    const approval = after.body.approvalHistory.find((h: any) => h.actionKind === 'APPROVE');
    assert.ok(approval);
    assert.equal(approval.performedBy.displayName, 'Ahmet Yılmaz');
  });

  it('IK tamamlar', async () => {
    const token = await login('elif.demir');
    const detail = await api('GET', `/api/requests/${requestId}`, { token });
    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: { actionCode: 'TAMAMLA', expectedRowVersion: detail.body.rowVersion },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.statusCode, 'COMPLETED');
  });
});

describe('Senaryo D: Yonetici reddi', () => {
  let requestId: string;
  let rowVersion: number;

  before(async () => {
    const token = await login('ayse.celik');
    const { id, detail } = await createAndSubmit(
      token,
      'KART_YETKISI',
      'Depo kart yetkisi talebi',
      { yetkiAlanlari: ['DEPO'], baslangicTarihi: '2026-09-01', suresizMi: true },
    );
    requestId = id;
    rowVersion = detail.rowVersion;
  });

  it('aciklama olmadan red reddedilir', async () => {
    const token = await login('ahmet.yilmaz');
    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: { actionCode: 'REDDET', expectedRowVersion: rowVersion },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /açıklama/i);
  });

  it('aciklama ile red uygulanir, audit ve bildirim olusur', async () => {
    const token = await login('ahmet.yilmaz');
    const res = await api('POST', `/api/requests/${requestId}/actions`, {
      token,
      body: {
        actionCode: 'REDDET',
        comment: 'Depo erişimi görev tanımında bulunmuyor.',
        expectedRowVersion: rowVersion,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.statusCode, 'REJECTED');

    const employeeToken = await login('ayse.celik');
    const detail = await api('GET', `/api/requests/${requestId}`, { token: employeeToken });
    assert.equal(detail.body.status.code, 'REJECTED');
    assert.equal(detail.body.whoHasIt, null);

    // Audit: REJECTED olayi ve aciklama
    const rejectEvent = detail.body.timeline.find((t: any) => t.eventType === 'REJECTED');
    assert.ok(rejectEvent, 'REJECTED audit kaydi olmali');
    assert.equal(rejectEvent.description, 'Depo erişimi görev tanımında bulunmuyor.');
    assert.equal(rejectEvent.userDisplayName, 'Ahmet Yılmaz');

    // Bildirim: talep sahibine
    const notifications = await prisma.notification.findMany({
      where: { requestId, event: 'REJECTED' },
    });
    assert.ok(notifications.length > 0, 'Red bildirimi olusmali');
    const requester = await prisma.user.findUniqueOrThrow({ where: { username: 'ayse.celik' } });
    assert.ok(notifications.some((n) => n.userId === requester.id));

    // Kalan adimlar iptal edilmis olmali
    const hrStep = detail.body.progress.find((s: any) => s.stepCode === 'HR_KONTROL');
    assert.equal(hrStep.status, 'CANCELLED');
  });
});

describe('Senaryo E: Cift tiklama tek aksiyon uretir', () => {
  it('ayni rowVersion ile iki kez onay gonderilirse tek aksiyon olusur', async () => {
    const employeeToken = await login('can.arslan');
    const { id, detail } = await createAndSubmit(
      employeeToken,
      'IZIN_BAKIYE',
      'Yıllık izin bakiye kontrolü',
      { yil: 2026 },
    );

    const managerToken = await login('fatma.aydin');
    const body = { actionCode: 'ONAYLA', expectedRowVersion: detail.rowVersion };

    // Ayni anda iki istek
    const [first, second] = await Promise.all([
      api('POST', `/api/requests/${id}/actions`, { token: managerToken, body }),
      api('POST', `/api/requests/${id}/actions`, { token: managerToken, body }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.equal(statuses[0], 200, 'Biri basarili olmali');
    assert.equal(statuses[1], 409, 'Digeri catisma ile reddedilmeli');

    // Yalnizca TEK aksiyon kaydi
    const logs = await prisma.workflowActionLog.findMany({
      where: { requestId: id, actionCode: 'ONAYLA' },
    });
    assert.equal(logs.length, 1, 'Iki aksiyon kaydi olusmamali');

    // Yalnizca TEK onay audit kaydi
    const approveAudits = await prisma.auditEvent.count({
      where: { requestId: id, eventType: 'APPROVED' },
    });
    assert.equal(approveAudits, 1);
  });

  it('taslak iki kez gonderilemez', async () => {
    const token = await login('deniz.koc');
    const created = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('BORDRO'),
        subject: 'Bordro talebi (taslak)',
        formData: BORDRO_FORM,
      },
    });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const detail = await api('GET', `/api/requests/${id}`, { token });
    const rv = detail.body.rowVersion;

    const [a, b] = await Promise.all([
      api('POST', `/api/requests/${id}/submit`, { token, body: { expectedRowVersion: rv } }),
      api('POST', `/api/requests/${id}/submit`, { token, body: { expectedRowVersion: rv } }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 200);
    assert.equal(statuses[1], 409);

    const instances = await prisma.workflowInstance.count({ where: { requestId: id } });
    assert.equal(instances, 1, 'Tek is akisi ornegi olusmali');
  });
});

describe('Senaryo F: Bayat veri yeni veriyi ezmez', () => {
  it('eski rowVersion ile islem 409 doner', async () => {
    const employeeToken = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      employeeToken,
      'PERSONEL_KART',
      'Kart yenileme talebi',
      { kartTipi: 'YENILEME' },
    );
    const staleRowVersion = detail.rowVersion;

    // Talep sahibi yorum ekler (rowVersion degismez) - yonetici onaylar (degisir)
    const managerToken = await login('ahmet.yilmaz');
    const ok = await api('POST', `/api/requests/${id}/actions`, {
      token: managerToken,
      body: { actionCode: 'ONAYLA', expectedRowVersion: staleRowVersion },
    });
    assert.equal(ok.status, 200);

    // IK bayat rowVersion ile islem yapmaya calisir
    const hrToken = await login('elif.demir');
    const stale = await api('POST', `/api/requests/${id}/actions`, {
      token: hrToken,
      body: { actionCode: 'TAMAMLA', expectedRowVersion: staleRowVersion },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_DATA');

    // Kayit hala IK kontrolunde
    const fresh = await api('GET', `/api/requests/${id}`, { token: hrToken });
    assert.equal(fresh.body.status.code, 'HR_REVIEW');
  });
});

// ---------------------------------------------------------------------------
// Yetki / gorunurluk
// ---------------------------------------------------------------------------

describe('Yetkilendirme', () => {
  it('calisan baska bir calisanin talebini goremez', async () => {
    const ownerToken = await login('can.arslan');
    const { id } = await createAndSubmit(ownerToken, 'BORDRO', 'Bordro (gizli)', BORDRO_FORM);

    const otherToken = await login('deniz.koc');
    const res = await api('GET', `/api/requests/${id}`, { token: otherToken });
    assert.equal(res.status, 404, 'Yetkisiz erisimde kayit varligi sizdirilmamali');
  });

  it('taslak talep yalnizca sahibine gorunur', async () => {
    const token = await login('can.arslan');
    const created = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('CALISMA_BELGESI'),
        subject: 'Çalışma belgesi taslağı',
        formData: { belgeDili: 'TR', kullanimAmaci: 'Banka', teslimSekli: 'EPOSTA' },
      },
    });
    const id = created.body.id;

    const hrToken = await login('elif.demir');
    const res = await api('GET', `/api/requests/${id}`, { token: hrToken });
    assert.equal(res.status, 404, 'IK taslak talebi gormemeli');
  });

  it('admin olmayan kullanici admin API kullanamaz', async () => {
    for (const username of ['mehmet.ozturk', 'ahmet.yilmaz', 'elif.demir', 'zeynep.kaya']) {
      const token = await login(username);
      const res = await api('GET', '/api/admin/workflows', { token });
      assert.equal(res.status, 403, `${username} admin API'ye erisememeli`);
    }
  });

  it('admin olmayan kullanici canli operasyon ekranina erisemez', async () => {
    const token = await login('zeynep.kaya');
    const res = await api('GET', '/api/admin/live/instances', { token });
    assert.equal(res.status, 403);
  });

  it('serbest status guncelleme endpointi yoktur', async () => {
    const token = await login('elif.demir');
    const res = await api('PATCH', '/api/requests/any-id/status', {
      token,
      body: { statusCode: 'COMPLETED' },
    });
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Ek bilgi isteme dongusu
// ---------------------------------------------------------------------------

describe('Ek bilgi isteme', () => {
  it('IK ek bilgi ister, talep sahibi bilgi gonderir, adim IK ya geri doner', async () => {
    const employeeToken = await login('mehmet.ozturk');
    const { id, detail } = await createAndSubmit(
      employeeToken,
      'VIZE_EVRAK',
      'Almanya vize evrakları',
      { ulke: 'Almanya', seyahatBaslangic: '2026-10-01', seyahatAmaci: 'IS' },
    );
    assert.equal(detail.status.code, 'HR_REVIEW');

    // IK ek bilgi ister
    const hrToken = await login('elif.demir');
    const hrDetail = await api('GET', `/api/requests/${id}`, { token: hrToken });
    const infoRes = await api('POST', `/api/requests/${id}/actions`, {
      token: hrToken,
      body: {
        actionCode: 'EK_BILGI_ISTE',
        comment: 'Pasaport fotokopisi eklenmemiş.',
        expectedRowVersion: hrDetail.body.rowVersion,
      },
    });
    assert.equal(infoRes.status, 200, JSON.stringify(infoRes.body));
    assert.equal(infoRes.body.statusCode, 'PENDING_INFO');

    // Talep sahibinde ve "Ek Bilgiyi Gonder" aksiyonu gorunur
    const back = await api('GET', `/api/requests/${id}`, { token: employeeToken });
    assert.equal(back.body.status.code, 'PENDING_INFO');
    assert.equal(back.body.whoHasIt, 'Mehmet Öztürk');
    assert.deepEqual(
      back.body.availableActions.map((a: any) => a.code),
      ['PROVIDE_INFO'],
    );

    // Bilgi gonderilir
    const provide = await api('POST', `/api/requests/${id}/actions`, {
      token: employeeToken,
      body: {
        actionCode: 'PROVIDE_INFO',
        comment: 'Pasaport fotokopisi eklendi.',
        expectedRowVersion: back.body.rowVersion,
      },
    });
    assert.equal(provide.status, 200, JSON.stringify(provide.body));
    assert.equal(provide.body.statusCode, 'HR_REVIEW');

    // Adim IK da, ayni adim ornegi (yeni adim olusmadi)
    const final = await api('GET', `/api/requests/${id}`, { token: hrToken });
    assert.equal(final.body.whoHasIt, 'İnsan Kaynakları');
    const hrSteps = final.body.progress.filter((s: any) => s.stepCode === 'HR_KONTROL');
    assert.equal(hrSteps.length, 1, 'Ek bilgi dongusu yeni adim ornegi uretmemeli');
  });
});

// ---------------------------------------------------------------------------
// Dosya ve yorum
// ---------------------------------------------------------------------------

describe('Dosya ve yorum', () => {
  it('dosya yuklenir, yetkisiz kullanici indiremez', async () => {
    const ownerToken = await login('mehmet.ozturk');
    const { id } = await createAndSubmit(ownerToken, 'BORDRO', 'Bordro (dosyalı)', BORDRO_FORM);

    const form = new FormData();
    form.append('file', new Blob(['test icerik'], { type: 'text/plain' }), 'belge.txt');

    const uploadRes = await fetch(`${baseUrl}/api/requests/${id}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: form,
    });
    assert.equal(uploadRes.status, 201);
    const attachment = (await uploadRes.json()) as any;
    assert.equal(attachment.fileName, 'belge.txt');

    // Yetkisiz kullanici indiremez
    const otherToken = await login('deniz.koc');
    const denied = await api('GET', `/api/requests/attachments/${attachment.id}/download`, {
      token: otherToken,
    });
    assert.equal(denied.status, 404);

    // Sahibi indirebilir
    const allowed = await fetch(
      `${baseUrl}/api/requests/attachments/${attachment.id}/download`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'test icerik');
  });

  it('dahili not talep sahibine gosterilmez', async () => {
    const ownerToken = await login('can.arslan');
    const { id } = await createAndSubmit(ownerToken, 'BORDRO', 'Bordro (notlu)', BORDRO_FORM);

    const hrToken = await login('elif.demir');
    const res = await api('POST', `/api/requests/${id}/comments`, {
      token: hrToken,
      body: { body: 'Dahili: SGK kaydı kontrol edilecek.', isInternal: true },
    });
    assert.equal(res.status, 201);

    const ownerView = await api('GET', `/api/requests/${id}/comments`, { token: ownerToken });
    assert.equal(ownerView.body.length, 0, 'Talep sahibi dahili notu gormemeli');

    const hrView = await api('GET', `/api/requests/${id}/comments`, { token: hrToken });
    assert.equal(hrView.body.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Form dogrulama
// ---------------------------------------------------------------------------

describe('Dinamik form dogrulama', () => {
  it('zorunlu alan eksikse gonderim reddedilir', async () => {
    const token = await login('mehmet.ozturk');
    const res = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('BORDRO'),
        subject: 'Eksik formlu bordro',
        formData: {},
        submit: true,
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = res.body.error.details.fields.map((f: any) => f.field);
    assert.ok(fields.includes('donem'));
  });

  it('gorunurluk kosulu saglanmayan alan zorunlu tutulmaz', async () => {
    const token = await login('mehmet.ozturk');
    // kartTipi=YENI -> kayipBeyani gizli, zorunlu degil
    const res = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('PERSONEL_KART'),
        subject: 'Yeni kart (beyan gerekmez)',
        formData: { kartTipi: 'YENI' },
        submit: true,
      },
    });
    assert.equal(res.status, 201);
  });

  it('gorunurluk kosulu saglanan alan zorunlu olur', async () => {
    const token = await login('mehmet.ozturk');
    const res = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('PERSONEL_KART'),
        subject: 'Kayıp kart (beyan eksik)',
        formData: { kartTipi: 'KAYIP' },
        submit: true,
      },
    });
    assert.equal(res.status, 400);
    const fields = res.body.error.details.fields.map((f: any) => f.field);
    assert.ok(fields.includes('kayipBeyani'));
  });

  it('gecersiz dropdown degeri reddedilir', async () => {
    const token = await login('mehmet.ozturk');
    const res = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('BORDRO'),
        subject: 'Hatalı format',
        formData: { donem: '2026-07', teslimFormat: 'FAKS' },
        submit: true,
      },
    });
    assert.equal(res.status, 400);
  });

  it('sayisal aralik dogrulanir', async () => {
    const token = await login('mehmet.ozturk');
    const res = await api('POST', '/api/requests', {
      token,
      body: {
        categoryId: await categoryIdByCode('STERIL_BILEKLIK'),
        subject: 'Çok fazla bileklik',
        formData: { alanKodu: 'STR-A2', bileklikAdedi: 99, gerekcesi: 'Test' },
        submit: true,
      },
    });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /en fazla 10/);
  });
});
