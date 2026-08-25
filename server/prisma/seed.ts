/**
 * Baslangic verisi.
 *
 * Idempotent: tekrar calistirilabilir (upsert kullanir).
 *
 * BURADA OLAN SEY KONFIGURASYONDUR, IS KURALI DEGIL:
 *  - Kategori adlari, hangi kategorinin yonetici onayi gerektirdigi, SLA
 *    sureleri, adim sorumlulari ve bildirim aliсilari veritabanina yazilir;
 *    uygulama kodunda bu bilgilerin hicbiri sabit degildir.
 *  - Admin bunlarin tamamini arayuzden degistirebilir.
 *
 * BUSINESS DECISION REQUIRED (placeholder degerler):
 *  - Yonetici onayi adimi SLA: 48 saat
 *  - IK kontrol adimi SLA: 72 saat
 *  - SLA takvim modu: CALENDAR_DAYS (takvim gunu). Is gunu / resmi tatil
 *    hesabi isteniyorsa BUSINESS_DAYS'e cevrilip Holiday tablosu doldurulmalidir.
 *  - Sorumlusu cozumlenemeyen adimlar icin yedek rol: HR_PROCESS_OWNER
 */

// ONEMLI: uygulama ile AYNI ortam dosyasi yuklenir (bkz. src/config/load-env.ts).
// Aksi halde seed gelistirme veritabanina, uygulama production'a baglanabilir.
import '../src/config/load-env';

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * DEMO MODU: ornek kullanicilari (Mehmet Ozturk, Ahmet Yilmaz, ...) olusturur.
 * Gelistirmede varsayilan acik. Production'da acikca DEMO_MODE=true gerekir;
 * aksi halde yalnizca referans veri (roller, durumlar, kategoriler, is akisi)
 * yazilir ve kullanicilar kurumsal kimlik saglayicidan beklenir.
 */
const DEMO_MODE = process.env.DEMO_MODE
  ? ['1', 'true', 'yes'].includes(process.env.DEMO_MODE.trim().toLowerCase())
  : !IS_PRODUCTION;

/** Ornek kullanicilarin ortak parolasi. Production + demo modda ZORUNLU. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? (IS_PRODUCTION ? '' : 'Parola123!');

if (DEMO_MODE && IS_PRODUCTION && SEED_PASSWORD.trim().length < 8) {
  console.error(
    'HATA: DEMO_MODE=true ve NODE_ENV=production iken SEED_PASSWORD (min 8 karakter) tanimlanmalidir.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Referans veriler
// ---------------------------------------------------------------------------

const ROLES = [
  { code: 'EMPLOYEE', name: 'Çalışan', description: 'Kendi taleplerini oluşturur ve takip eder.', sortOrder: 10 },
  { code: 'MANAGER', name: 'Yönetici', description: 'Kendisine yönlenen talepleri onaylar veya reddeder.', sortOrder: 20 },
  { code: 'HR_USER', name: 'İnsan Kaynakları', description: 'Yetkili olduğu İK taleplerini işler.', sortOrder: 30 },
  { code: 'HR_PROCESS_OWNER', name: 'İK Süreç Sahibi', description: 'Süreç sahibi / üst seviye İK yetkilisi.', sortOrder: 40 },
  { code: 'ADMIN', name: 'Sistem Yöneticisi', description: 'Yönetim ve müdahale fonksiyonlarına erişir.', sortOrder: 50 },
];

const STATUSES = [
  { code: 'DRAFT', name: 'Taslak', phase: 'OPEN', isTerminal: false, allowAdminOverride: false, tone: 'neutral', sortOrder: 10, description: 'Talep henüz gönderilmedi.' },
  { code: 'SUBMITTED', name: 'Gönderildi', phase: 'OPEN', isTerminal: false, allowAdminOverride: false, tone: 'info', sortOrder: 20, description: 'Talep gönderildi, yönlendirme bekliyor.' },
  { code: 'PENDING_MANAGER_APPROVAL', name: 'Yönetici Onayı Bekliyor', phase: 'OPEN', isTerminal: false, allowAdminOverride: true, tone: 'warning', sortOrder: 30, description: 'Birinci yönetici onayında.' },
  { code: 'HR_REVIEW', name: 'İnsan Kaynakları Kontrolünde', phase: 'OPEN', isTerminal: false, allowAdminOverride: true, tone: 'info', sortOrder: 40, description: 'İK tarafından inceleniyor.' },
  { code: 'IN_PROGRESS', name: 'İşleme Alındı', phase: 'OPEN', isTerminal: false, allowAdminOverride: true, tone: 'info', sortOrder: 50, description: 'İşlem devam ediyor.' },
  { code: 'PENDING_INFO', name: 'Ek Bilgi Bekleniyor', phase: 'OPEN', isTerminal: false, allowAdminOverride: true, tone: 'warning', sortOrder: 60, description: 'Talep sahibinden ek bilgi bekleniyor.' },
  { code: 'APPROVED', name: 'Onaylandı', phase: 'OPEN', isTerminal: false, allowAdminOverride: false, tone: 'success', sortOrder: 70, description: 'Onaylandı, sonuçlandırma bekliyor.' },
  { code: 'RESOLVED', name: 'Çözüldü', phase: 'OPEN', isTerminal: false, allowAdminOverride: true, tone: 'success', sortOrder: 80, description: 'Çözüldü, kapanış bekliyor.' },
  { code: 'COMPLETED', name: 'Tamamlandı', phase: 'CLOSED', isTerminal: true, allowAdminOverride: true, tone: 'success', sortOrder: 90, description: 'Talep tamamlandı.' },
  { code: 'REJECTED', name: 'Reddedildi', phase: 'CLOSED', isTerminal: true, allowAdminOverride: false, tone: 'danger', sortOrder: 100, description: 'Talep reddedildi.' },
  { code: 'CANCELLED', name: 'İptal Edildi', phase: 'CLOSED', isTerminal: true, allowAdminOverride: true, tone: 'neutral', sortOrder: 110, description: 'Talep iptal edildi.' },
];

const PRIORITIES = [
  { code: 'LOW', name: 'Düşük', tone: 'neutral', sortOrder: 10 },
  { code: 'MEDIUM', name: 'Orta', tone: 'info', sortOrder: 20 },
  { code: 'HIGH', name: 'Yüksek', tone: 'danger', sortOrder: 30 },
];

const SETTINGS = [
  { key: 'sla.calendarMode', value: 'CALENDAR_DAYS', valueType: 'string', category: 'SLA', description: 'SLA hesabı takvim günü mü iş günü mü? CALENDAR_DAYS | BUSINESS_DAYS. (İş kararı gerektirir.)' },
  { key: 'sla.workDayStartHour', value: '9', valueType: 'number', category: 'SLA', description: 'BUSINESS_DAYS modunda mesai başlangıç saati.' },
  { key: 'sla.workDayEndHour', value: '18', valueType: 'number', category: 'SLA', description: 'BUSINESS_DAYS modunda mesai bitiş saati.' },
  { key: 'sla.includeWeekends', value: 'false', valueType: 'boolean', category: 'SLA', description: 'BUSINESS_DAYS modunda hafta sonu iş günü sayılsın mı?' },
  { key: 'sla.atRiskThresholdPercent', value: '80', valueType: 'number', category: 'SLA', description: 'Sürenin yüzde kaçı geçtiğinde talep "riskli" sayılsın.' },
  { key: 'notification.enabledChannels', value: '["IN_APP"]', valueType: 'json', category: 'NOTIFICATION', description: 'Etkin bildirim kanalları. E-posta/Teams entegrasyonu bağlandığında eklenir.' },
  { key: 'assignee.fallbackRoleCode', value: 'HR_PROCESS_OWNER', valueType: 'string', category: 'GENERAL', description: 'Adımın sorumlusu çözümlenemezse (ör. yönetici tanımsız/pasif) görev bu role düşer.' },
  { key: 'attachment.maxSizeMb', value: '20', valueType: 'number', category: 'GENERAL', description: 'Tek dosya için en büyük boyut (MB).' },
  { key: 'attachment.allowedMimeTypes', value: '[]', valueType: 'json', category: 'SECURITY', description: 'İzin verilen dosya türleri. Boş liste = kısıtlama yok.' },
];

// ---------------------------------------------------------------------------
// Kullanicilar (kurumsal dizin simulasyonu)
// ---------------------------------------------------------------------------

interface SeedUser {
  username: string;
  displayName: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
  department: string;
  departmentCode: string;
  title: string;
  managerUsername: string | null;
  roles: string[];
}

const USERS: SeedUser[] = [
  {
    username: 'selim.bora', displayName: 'Selim Bora', firstName: 'Selim', lastName: 'Bora',
    employeeNo: 'E1001', department: 'Genel Müdürlük', departmentCode: 'GM', title: 'Genel Müdür',
    managerUsername: null, roles: ['EMPLOYEE', 'MANAGER'],
  },
  {
    username: 'zeynep.kaya', displayName: 'Zeynep Kaya', firstName: 'Zeynep', lastName: 'Kaya',
    employeeNo: 'E1002', department: 'İnsan Kaynakları', departmentCode: 'IK', title: 'İnsan Kaynakları Direktörü',
    managerUsername: 'selim.bora', roles: ['EMPLOYEE', 'MANAGER', 'HR_PROCESS_OWNER'],
  },
  {
    username: 'elif.demir', displayName: 'Elif Demir', firstName: 'Elif', lastName: 'Demir',
    employeeNo: 'E1003', department: 'İnsan Kaynakları', departmentCode: 'IK', title: 'İK Uzmanı',
    managerUsername: 'zeynep.kaya', roles: ['EMPLOYEE', 'HR_USER'],
  },
  {
    username: 'murat.sahin', displayName: 'Murat Şahin', firstName: 'Murat', lastName: 'Şahin',
    employeeNo: 'E1004', department: 'İnsan Kaynakları', departmentCode: 'IK', title: 'İK Uzmanı',
    managerUsername: 'zeynep.kaya', roles: ['EMPLOYEE', 'HR_USER'],
  },
  {
    username: 'ahmet.yilmaz', displayName: 'Ahmet Yılmaz', firstName: 'Ahmet', lastName: 'Yılmaz',
    employeeNo: 'E1005', department: 'Üretim', departmentCode: 'URT', title: 'Üretim Müdürü',
    managerUsername: 'selim.bora', roles: ['EMPLOYEE', 'MANAGER'],
  },
  {
    username: 'fatma.aydin', displayName: 'Fatma Aydın', firstName: 'Fatma', lastName: 'Aydın',
    employeeNo: 'E1006', department: 'Kalite Güvence', departmentCode: 'KG', title: 'Kalite Güvence Müdürü',
    managerUsername: 'selim.bora', roles: ['EMPLOYEE', 'MANAGER'],
  },
  {
    username: 'mehmet.ozturk', displayName: 'Mehmet Öztürk', firstName: 'Mehmet', lastName: 'Öztürk',
    employeeNo: 'E1007', department: 'Üretim', departmentCode: 'URT', title: 'Üretim Operatörü',
    managerUsername: 'ahmet.yilmaz', roles: ['EMPLOYEE'],
  },
  {
    username: 'ayse.celik', displayName: 'Ayşe Çelik', firstName: 'Ayşe', lastName: 'Çelik',
    employeeNo: 'E1008', department: 'Üretim', departmentCode: 'URT', title: 'Üretim Planlama Uzmanı',
    managerUsername: 'ahmet.yilmaz', roles: ['EMPLOYEE'],
  },
  {
    username: 'can.arslan', displayName: 'Can Arslan', firstName: 'Can', lastName: 'Arslan',
    employeeNo: 'E1009', department: 'Kalite Güvence', departmentCode: 'KG', title: 'Kalite Kontrol Analisti',
    managerUsername: 'fatma.aydin', roles: ['EMPLOYEE'],
  },
  {
    username: 'deniz.koc', displayName: 'Deniz Koç', firstName: 'Deniz', lastName: 'Koç',
    employeeNo: 'E1010', department: 'Kalite Güvence', departmentCode: 'KG', title: 'Laboratuvar Teknisyeni',
    managerUsername: 'fatma.aydin', roles: ['EMPLOYEE'],
  },
  {
    username: 'sistem.yonetici', displayName: 'Sistem Yöneticisi', firstName: 'Sistem', lastName: 'Yöneticisi',
    employeeNo: 'E1011', department: 'Bilgi Teknolojileri', departmentCode: 'BT', title: 'Uygulama Yöneticisi',
    managerUsername: 'selim.bora', roles: ['EMPLOYEE', 'ADMIN'],
  },
];

// ---------------------------------------------------------------------------
// Kategoriler
// ---------------------------------------------------------------------------

interface SeedField {
  key: string;
  label: string;
  fieldType: string;
  isRequired?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: Record<string, unknown>;
  visibilityCondition?: {
    combinator: 'AND' | 'OR';
    rules: Array<{ field: string; operator: string; value?: unknown }>;
  };
}

interface SeedCategory {
  code: string;
  name: string;
  description: string;
  prefix: string;
  requiresManagerApproval: boolean;
  defaultPriority: string;
  defaultSlaHours: number;
  ownerRoleCode: string;
  fields: SeedField[];
}

const CATEGORIES: SeedCategory[] = [
  {
    code: 'BORDRO', name: 'Bordro Talebi', prefix: 'BRD',
    description: 'Belirli bir döneme ait bordro/maaş pusulası talebi.',
    requiresManagerApproval: false, defaultPriority: 'MEDIUM', defaultSlaHours: 72,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'donem', label: 'Dönem', fieldType: 'TEXT', isRequired: true, placeholder: '2026-07', helpText: 'Yıl-Ay biçiminde giriniz.', validation: { pattern: '^\\d{4}-\\d{2}$', maxLength: 7 } },
      { key: 'teslimFormat', label: 'Teslim Formatı', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'PDF', label: 'PDF (e-posta)' }, { value: 'BASILI', label: 'Basılı kopya' } ] },
    ],
  },
  {
    code: 'CALISMA_BELGESI', name: 'Çalışma Belgesi Talebi', prefix: 'CLB',
    description: 'Kurum tarafından düzenlenen çalışma/hizmet belgesi talebi.',
    requiresManagerApproval: false, defaultPriority: 'MEDIUM', defaultSlaHours: 72,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'belgeDili', label: 'Belge Dili', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'TR', label: 'Türkçe' }, { value: 'EN', label: 'İngilizce' } ] },
      { key: 'kullanimAmaci', label: 'Kullanım Amacı', fieldType: 'TEXT', isRequired: true, placeholder: 'Örn. banka başvurusu', validation: { maxLength: 200 } },
      { key: 'teslimSekli', label: 'Teslim Şekli', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'ELDEN', label: 'Elden' }, { value: 'EPOSTA', label: 'E-posta' }, { value: 'KARGO', label: 'Kargo' } ] },
    ],
  },
  {
    code: 'PERSONEL_KART', name: 'Personel Kart Talebi', prefix: 'PKT',
    description: 'Yeni personel kartı, yenileme veya kayıp/hasar durumunda kart talebi.',
    requiresManagerApproval: true, defaultPriority: 'MEDIUM', defaultSlaHours: 120,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'kartTipi', label: 'Kart Tipi', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'YENI', label: 'Yeni kart' }, { value: 'YENILEME', label: 'Yenileme' }, { value: 'KAYIP', label: 'Kayıp / hasar' } ] },
      { key: 'kayipBeyani', label: 'Kayıp / Hasar Beyanı', fieldType: 'LONG_TEXT', isRequired: true, helpText: 'Kart tipi "Kayıp / hasar" seçildiğinde zorunludur.', visibilityCondition: { combinator: 'AND', rules: [{ field: 'form.kartTipi', operator: 'EQUALS', value: 'KAYIP' }] }, validation: { maxLength: 1000 } },
    ],
  },
  {
    code: 'STERIL_BILEKLIK', name: 'Steril Alan Bileklik Tanımlaması Talebi', prefix: 'SAB',
    description: 'Steril alan erişimi için bileklik tanımlama talebi.',
    requiresManagerApproval: true, defaultPriority: 'HIGH', defaultSlaHours: 72,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'alanKodu', label: 'Steril Alan Kodu', fieldType: 'TEXT', isRequired: true, placeholder: 'Örn. STR-A2', validation: { maxLength: 30 } },
      { key: 'bileklikAdedi', label: 'Bileklik Adedi', fieldType: 'NUMBER', isRequired: true, validation: { min: 1, max: 10 } },
      { key: 'gerekcesi', label: 'Gerekçe', fieldType: 'LONG_TEXT', isRequired: true, validation: { maxLength: 1000 } },
    ],
  },
  {
    code: 'KART_YETKISI', name: 'Kart Yetkisi Talebi', prefix: 'KYT',
    description: 'Personel kartına alan/kapı erişim yetkisi tanımlama talebi.',
    requiresManagerApproval: true, defaultPriority: 'MEDIUM', defaultSlaHours: 72,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'yetkiAlanlari', label: 'Yetki Alanları', fieldType: 'MULTI_SELECT', isRequired: true, options: [ { value: 'URETIM', label: 'Üretim' }, { value: 'DEPO', label: 'Depo' }, { value: 'LABORATUVAR', label: 'Laboratuvar' }, { value: 'YONETIM', label: 'Yönetim Katı' }, { value: 'ARSIV', label: 'Arşiv' } ] },
      { key: 'baslangicTarihi', label: 'Yetki Başlangıç Tarihi', fieldType: 'DATE', isRequired: true },
      { key: 'suresizMi', label: 'Süresiz Yetki', fieldType: 'CHECKBOX' },
      { key: 'bitisTarihi', label: 'Yetki Bitiş Tarihi', fieldType: 'DATE', helpText: 'Süresiz yetki seçilmediyse doldurulmalıdır.', visibilityCondition: { combinator: 'AND', rules: [{ field: 'form.suresizMi', operator: 'NOT_EQUALS', value: true }] } },
    ],
  },
  {
    code: 'VIZE_EVRAK', name: 'Vize Evrakları Talebi', prefix: 'VZE',
    description: 'Yurt dışı seyahat için vize başvuru evrakları talebi.',
    requiresManagerApproval: false, defaultPriority: 'HIGH', defaultSlaHours: 120,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'ulke', label: 'Ülke', fieldType: 'TEXT', isRequired: true, validation: { maxLength: 60 } },
      { key: 'seyahatBaslangic', label: 'Seyahat Başlangıç Tarihi', fieldType: 'DATE', isRequired: true },
      { key: 'seyahatAmaci', label: 'Seyahat Amacı', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'IS', label: 'İş seyahati' }, { value: 'EGITIM', label: 'Eğitim' }, { value: 'FUAR', label: 'Fuar / kongre' } ] },
    ],
  },
  {
    code: 'IZIN_IPTAL', name: 'Yıllık İzin İptali Talebi', prefix: 'YII',
    description: 'Onaylanmış yıllık izin kaydının iptali talebi.',
    requiresManagerApproval: true, defaultPriority: 'HIGH', defaultSlaHours: 48,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'izinBaslangic', label: 'İzin Başlangıç Tarihi', fieldType: 'DATE', isRequired: true },
      { key: 'izinBitis', label: 'İzin Bitiş Tarihi', fieldType: 'DATE', isRequired: true },
      { key: 'iptalGerekcesi', label: 'İptal Gerekçesi', fieldType: 'LONG_TEXT', isRequired: true, validation: { maxLength: 1000 } },
    ],
  },
  {
    code: 'IZIN_BAKIYE', name: 'Yıllık İzin Bakiye Kontrolü Talebi', prefix: 'YIB',
    description: 'Yıllık izin bakiyesinin kontrol edilmesi ve bildirilmesi talebi.',
    requiresManagerApproval: true, defaultPriority: 'LOW', defaultSlaHours: 72,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'yil', label: 'Yıl', fieldType: 'NUMBER', isRequired: true, validation: { min: 2000, max: 2100 } },
      { key: 'aciklamaTalebi', label: 'Detaylı Döküm İsteniyor', fieldType: 'CHECKBOX' },
    ],
  },
  {
    code: 'TASERON_YEMEK', name: 'Taşeron Personel Yemek Kaydı Talebi', prefix: 'TYK',
    description: 'Taşeron firma personeli için yemek kaydı oluşturma talebi.',
    requiresManagerApproval: false, defaultPriority: 'MEDIUM', defaultSlaHours: 48,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'taseronFirma', label: 'Taşeron Firma', fieldType: 'TEXT', isRequired: true, validation: { maxLength: 120 } },
      { key: 'personelSayisi', label: 'Personel Sayısı', fieldType: 'NUMBER', isRequired: true, validation: { min: 1, max: 500 } },
      { key: 'baslangicTarihi', label: 'Kayıt Başlangıç Tarihi', fieldType: 'DATE', isRequired: true },
    ],
  },
  {
    code: 'SAGLIK_SIGORTA', name: 'Sağlık Sigortası Talepleri', prefix: 'SGS',
    description: 'Özel sağlık sigortası kayıt, aile ekleme ve çıkış işlemleri.',
    requiresManagerApproval: false, defaultPriority: 'MEDIUM', defaultSlaHours: 120,
    ownerRoleCode: 'HR_USER',
    fields: [
      { key: 'islemTipi', label: 'İşlem Tipi', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'YENI_KAYIT', label: 'Yeni kayıt' }, { value: 'AILE_EKLEME', label: 'Aile üyesi ekleme' }, { value: 'CIKIS', label: 'Çıkış' } ] },
      { key: 'yakinlikDerecesi', label: 'Yakınlık Derecesi', fieldType: 'DROPDOWN', isRequired: true, options: [ { value: 'ES', label: 'Eş' }, { value: 'COCUK', label: 'Çocuk' } ], helpText: 'Aile üyesi ekleme işleminde zorunludur.', visibilityCondition: { combinator: 'AND', rules: [{ field: 'form.islemTipi', operator: 'EQUALS', value: 'AILE_EKLEME' }] } },
      { key: 'aileUyesiAdi', label: 'Aile Üyesi Adı Soyadı', fieldType: 'TEXT', isRequired: true, visibilityCondition: { combinator: 'AND', rules: [{ field: 'form.islemTipi', operator: 'EQUALS', value: 'AILE_EKLEME' }] }, validation: { maxLength: 120 } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Standart workflow tanimi
// ---------------------------------------------------------------------------

const WORKFLOW_CODE = 'HR_STANDART';

async function main(): Promise<void> {
  console.log('Seed basliyor...');

  // --- Roller ---
  for (const role of ROLES) {
    await prisma.role.upsert({ where: { code: role.code }, update: role, create: role });
  }
  console.log(`  ${ROLES.length} rol hazir`);

  // --- Durumlar ve oncelikler ---
  for (const status of STATUSES) {
    await prisma.statusDefinition.upsert({
      where: { code: status.code },
      update: status,
      create: status,
    });
  }
  for (const priority of PRIORITIES) {
    await prisma.priorityDefinition.upsert({
      where: { code: priority.code },
      update: priority,
      create: priority,
    });
  }
  console.log(`  ${STATUSES.length} durum, ${PRIORITIES.length} oncelik hazir`);

  // --- Ayarlar ---
  for (const setting of SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {
        valueType: setting.valueType,
        category: setting.category,
        description: setting.description,
      },
      create: setting,
    });
  }
  console.log(`  ${SETTINGS.length} ayar hazir`);

  // --- Kullanicilar (yalnizca demo modunda) ---
  if (!DEMO_MODE) {
    console.log('  DEMO_MODE kapali: ornek kullanicilar olusturulmadi.');
    console.log('  Kullanicilar kurumsal kimlik saglayicidan (OIDC) alinmalidir.');
    await seedWorkflowAndCategories(null);
    console.log('');
    console.log('Seed tamamlandi (yalnizca referans veri).');
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const userIdByUsername = new Map<string, string>();

  for (const u of USERS) {
    const email = `${u.username}@ornek-kurum.local`;
    const created = await prisma.user.upsert({
      where: { username: u.username },
      update: {
        displayName: u.displayName,
        firstName: u.firstName,
        lastName: u.lastName,
        department: u.department,
        departmentCode: u.departmentCode,
        title: u.title,
        isActive: true,
      },
      create: {
        username: u.username,
        email,
        employeeNo: u.employeeNo,
        displayName: u.displayName,
        firstName: u.firstName,
        lastName: u.lastName,
        department: u.department,
        departmentCode: u.departmentCode,
        title: u.title,
        passwordHash,
        source: 'SEED',
      },
    });
    userIdByUsername.set(u.username, created.id);
  }

  // Yonetici hiyerarsisi (ikinci gecis: tum id'ler hazir)
  for (const u of USERS) {
    await prisma.user.update({
      where: { id: userIdByUsername.get(u.username)! },
      data: {
        managerId: u.managerUsername ? userIdByUsername.get(u.managerUsername)! : null,
      },
    });
    for (const roleCode of u.roles) {
      await prisma.userRole.upsert({
        where: { userId_roleCode: { userId: userIdByUsername.get(u.username)!, roleCode } },
        update: {},
        create: { userId: userIdByUsername.get(u.username)!, roleCode },
      });
    }
  }
  console.log(`  ${USERS.length} kullanici + roller + yonetici hiyerarsisi hazir`);

  // --- Grup ---
  const hrGroup = await prisma.userGroup.upsert({
    where: { code: 'IK_OPERASYON' },
    update: { name: 'İK Operasyon Ekibi' },
    create: {
      code: 'IK_OPERASYON',
      name: 'İK Operasyon Ekibi',
      description: 'Günlük İK taleplerini karşılayan ekip.',
    },
  });
  for (const username of ['elif.demir', 'murat.sahin']) {
    await prisma.userGroupMember.upsert({
      where: { groupId_userId: { groupId: hrGroup.id, userId: userIdByUsername.get(username)! } },
      update: {},
      create: { groupId: hrGroup.id, userId: userIdByUsername.get(username)! },
    });
  }
  console.log('  IK Operasyon ekibi hazir');

  await seedWorkflowAndCategories(userIdByUsername.get('sistem.yonetici') ?? null);

  console.log('');
  console.log('Seed tamamlandi.');
  console.log(`Demo kullanici parolasi: ${SEED_PASSWORD}`);
  console.log('Ornek kullanicilar:');
  console.log('  mehmet.ozturk   - Calisan (yoneticisi: Ahmet Yilmaz)');
  console.log('  ahmet.yilmaz    - Yonetici');
  console.log('  elif.demir      - Insan Kaynaklari');
  console.log('  zeynep.kaya     - IK Surec Sahibi');
  console.log('  sistem.yonetici - Admin');
}

main()
  .catch((err) => {
    console.error('Seed hatasi:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });


/**
 * Referans konfigurasyon: standart is akisi (v1) + kategoriler + form alanlari.
 * Demo kullanicilari olmadan da calisir (adminId null olabilir).
 */
async function seedWorkflowAndCategories(adminId: string | null): Promise<void> {
  // --- Workflow tanimi ve v1 ---
  const definition = await prisma.workflowDefinition.upsert({
    where: { code: WORKFLOW_CODE },
    update: { name: 'İK Standart Talep Akışı' },
    create: {
      code: WORKFLOW_CODE,
      name: 'İK Standart Talep Akışı',
      description:
        'Tüm İK talepleri için standart akış. Yönetici onayı adımı, kategorinin "yönetici onayı gerekli" ayarına göre koşullu çalışır.',
      status: 'DRAFT',
      createdById: adminId,
      updatedById: adminId,
    },
  });

  const existingV1 = await prisma.workflowVersion.findUnique({
    where: { definitionId_versionNumber: { definitionId: definition.id, versionNumber: 1 } },
  });

  let versionId: string;

  if (existingV1) {
    versionId = existingV1.id;
    console.log('  Workflow v1 zaten var, adim kurulumu atlandi');
  } else {
    const version = await prisma.workflowVersion.create({
      data: {
        definitionId: definition.id,
        versionNumber: 1,
        status: 'DRAFT',
        changeDescription: 'İlk sürüm (sistem tarafından oluşturuldu)',
        createdById: adminId,
        slaCalendarMode: 'CALENDAR_DAYS',
      },
    });
    versionId = version.id;

    // 1) Talep Olusturma (START)
    const stepStart = await prisma.workflowStep.create({
      data: {
        versionId, code: 'TALEP_OLUSTURMA', name: 'Talep Oluşturma', type: 'START', sequence: 1,
        assigneeType: 'REQUESTER', statusCode: 'DRAFT',
        description: 'Çalışan talebi oluşturur ve gönderir.',
      },
    });

    // 2) Yonetici Onayi (APPROVAL) - KOSULLU
    const stepManager = await prisma.workflowStep.create({
      data: {
        versionId, code: 'YONETICI_ONAYI', name: 'Yönetici Onayı', type: 'APPROVAL', sequence: 2,
        assigneeType: 'REQUESTER_MANAGER', statusCode: 'PENDING_MANAGER_APPROVAL',
        description: 'Talep edenin birinci yöneticisi onaylar veya reddeder.',
        slaEnabled: true, slaHours: 48, slaReminderHours: 24,
        // Routing kurali: kategori "yonetici onayi gerekli" ise bu adim calisir.
        conditionJson: JSON.stringify({
          combinator: 'AND',
          rules: [
            { field: 'category.requiresManagerApproval', operator: 'EQUALS', value: true },
          ],
        }),
      },
    });

    // 3) IK Kontrol (REVIEW)
    const stepHr = await prisma.workflowStep.create({
      data: {
        versionId, code: 'HR_KONTROL', name: 'İnsan Kaynakları Kontrolü', type: 'REVIEW', sequence: 3,
        assigneeType: 'HR_USER', statusCode: 'HR_REVIEW',
        description: 'İK talebi inceler ve sonuçlandırır.',
        slaEnabled: true, slaHours: 72, slaReminderHours: 48,
      },
    });

    // 4) Tamamlandi (END) - aksiyonu yok, ulasildiginda akis kapanir
    await prisma.workflowStep.create({
      data: {
        versionId, code: 'TAMAMLANDI', name: 'Tamamlandı', type: 'END', sequence: 4,
        assigneeType: 'HR_USER', statusCode: 'COMPLETED',
        description: 'Akışın bitiş adımı.',
      },
    });

    await prisma.workflowAction.createMany({
      data: [
        // START
        {
          stepId: stepStart.id, code: 'GONDER', name: 'Gönder', kind: 'SUBMIT',
          targetStepMode: 'NEXT', variant: 'PRIMARY', sortOrder: 1,
        },
        // Yonetici Onayi
        {
          stepId: stepManager.id, code: 'ONAYLA', name: 'Onayla', kind: 'APPROVE',
          targetStepMode: 'NEXT', targetStatusCode: 'HR_REVIEW',
          confirmationRequired: true, variant: 'PRIMARY', sortOrder: 1,
        },
        {
          stepId: stepManager.id, code: 'REDDET', name: 'Reddet', kind: 'REJECT',
          targetStepMode: 'END', targetStatusCode: 'REJECTED',
          commentRequired: true, confirmationRequired: true, variant: 'DANGER', sortOrder: 2,
        },
        // IK Kontrol
        {
          stepId: stepHr.id, code: 'TAMAMLA', name: 'Tamamla', kind: 'COMPLETE',
          targetStepMode: 'NEXT', targetStatusCode: 'COMPLETED',
          confirmationRequired: true, variant: 'PRIMARY', sortOrder: 1,
        },
        {
          stepId: stepHr.id, code: 'EK_BILGI_ISTE', name: 'Ek Bilgi İste', kind: 'REQUEST_INFO',
          targetStepMode: 'REQUESTER', targetStatusCode: 'PENDING_INFO',
          commentRequired: true, variant: 'DEFAULT', sortOrder: 2,
        },
        {
          stepId: stepHr.id, code: 'REDDET', name: 'Reddet', kind: 'REJECT',
          targetStepMode: 'END', targetStatusCode: 'REJECTED',
          commentRequired: true, confirmationRequired: true, variant: 'DANGER', sortOrder: 3,
        },
      ],
    });

    await prisma.notificationRule.createMany({
      data: [
        { versionId, event: 'REQUEST_SUBMITTED', recipientType: 'REQUESTER' },
        { versionId, event: 'STEP_STARTED', recipientType: 'CURRENT_ASSIGNEE' },
        { versionId, event: 'APPROVED', recipientType: 'REQUESTER' },
        { versionId, event: 'REJECTED', recipientType: 'REQUESTER' },
        { versionId, event: 'INFO_REQUESTED', recipientType: 'REQUESTER' },
        { versionId, event: 'COMPLETED', recipientType: 'REQUESTER' },
        { versionId, event: 'CANCELLED', recipientType: 'CURRENT_ASSIGNEE' },
        { versionId, event: 'SLA_WARNING', recipientType: 'CURRENT_ASSIGNEE' },
        { versionId, event: 'SLA_BREACH', recipientType: 'CURRENT_ASSIGNEE' },
        { versionId, event: 'SLA_BREACH', recipientType: 'ROLE', recipientRoleCode: 'HR_PROCESS_OWNER' },
        { versionId, event: 'ADMIN_OVERRIDE', recipientType: 'CURRENT_ASSIGNEE' },
        { versionId, event: 'ADMIN_OVERRIDE', recipientType: 'REQUESTER' },
      ],
    });

    // Yayinla: v1 ACTIVE
    await prisma.workflowVersion.update({
      where: { id: versionId },
      data: {
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedById: adminId,
      },
    });
    await prisma.workflowDefinition.update({
      where: { id: definition.id },
      data: { activeVersionId: versionId, status: 'ACTIVE' },
    });

    console.log('  Workflow v1 olusturuldu ve yayinlandi (4 adim, 6 aksiyon)');
  }

  // --- Kategoriler + form alanlari ---
  for (const [index, cat] of CATEGORIES.entries()) {
    const category = await prisma.requestCategory.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        description: cat.description,
        requiresManagerApproval: cat.requiresManagerApproval,
        defaultPriority: cat.defaultPriority,
        defaultSlaHours: cat.defaultSlaHours,
        ownerRoleCode: cat.ownerRoleCode,
        requestNoPrefix: cat.prefix,
        workflowDefinitionId: definition.id,
        sortOrder: (index + 1) * 10,
        isActive: true,
      },
      create: {
        code: cat.code,
        name: cat.name,
        description: cat.description,
        requiresManagerApproval: cat.requiresManagerApproval,
        defaultPriority: cat.defaultPriority,
        defaultSlaHours: cat.defaultSlaHours,
        ownerRoleCode: cat.ownerRoleCode,
        requestNoPrefix: cat.prefix,
        workflowDefinitionId: definition.id,
        sortOrder: (index + 1) * 10,
      },
    });

    for (const [fieldIndex, field] of cat.fields.entries()) {
      await prisma.categoryFormField.upsert({
        where: { categoryId_key: { categoryId: category.id, key: field.key } },
        update: {
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired ?? false,
          helpText: field.helpText ?? null,
          placeholder: field.placeholder ?? null,
          optionsJson: field.options ? JSON.stringify(field.options) : null,
          validationJson: field.validation ? JSON.stringify(field.validation) : null,
          visibilityConditionJson: field.visibilityCondition
            ? JSON.stringify(field.visibilityCondition)
            : null,
          sortOrder: (fieldIndex + 1) * 10,
          isActive: true,
        },
        create: {
          categoryId: category.id,
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired ?? false,
          helpText: field.helpText ?? null,
          placeholder: field.placeholder ?? null,
          optionsJson: field.options ? JSON.stringify(field.options) : null,
          validationJson: field.validation ? JSON.stringify(field.validation) : null,
          visibilityConditionJson: field.visibilityCondition
            ? JSON.stringify(field.visibilityCondition)
            : null,
          sortOrder: (fieldIndex + 1) * 10,
        },
      });
    }
  }

  const approvalCount = CATEGORIES.filter((c) => c.requiresManagerApproval).length;
  console.log(
    `  ${CATEGORIES.length} kategori hazir (${approvalCount} tanesi yonetici onayi gerektiriyor)`,
  );
}