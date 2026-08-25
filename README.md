# İK Self Servis

Kurumsal İnsan Kaynakları self servis uygulaması ve İK süreçlerine yeterli seviyede
konfigüre edilebilir iş akışı yönetimi.

> **Kapsam notu:** Bu proje genel amaçlı bir BPM / Camunda / Power Automate alternatifi
> **değildir**. İş akışı motoru bilinçli olarak sıralı adım yürütmesiyle sınırlıdır:
> paralel branch, retry engine, generic rule engine, BPMN canvas, script node ve otomatik
> workflow migration **yoktur**.

---

## 1. Hızlı Başlangıç

```bash
# 1) Bağımlılıklar
npm install

# 2) Ortam dosyası
cp server/.env.example server/.env      # PRODUCTION'DA JWT_SECRET'I DEĞİŞTİRİN

# 3) Veritabanı + başlangıç verisi
npm run db:reset --workspace server

# 4) API + web (paralel)
npm run dev
```

| Servis | Adres |
| --- | --- |
| Web (Vite) | http://localhost:5173 |
| API | http://localhost:4000/api |
| Health | http://localhost:4000/api/health |

### Örnek kullanıcılar

Dev girişinde parola: `Parola123!` (veya giriş ekranındaki "hızlı kullanıcı seçimi").

| Kullanıcı | Rol | Not |
| --- | --- | --- |
| `mehmet.ozturk` | Çalışan | Yöneticisi: Ahmet Yılmaz |
| `ayse.celik` | Çalışan | Yöneticisi: Ahmet Yılmaz |
| `ahmet.yilmaz` | Yönetici | Üretim Müdürü |
| `fatma.aydin` | Yönetici | Kalite Güvence Müdürü |
| `elif.demir` | İnsan Kaynakları | İK Uzmanı |
| `zeynep.kaya` | İK Süreç Sahibi | İK Direktörü |
| `sistem.yonetici` | Admin | Yönetim + canlı süreç müdahalesi |

### Testler

```bash
npm test --workspace server     # 57 entegrasyon testi (HTTP seviyesinde)
npm run typecheck               # server + web
```

Her test dosyası kendi veritabanıyla çalışır ve bu veritabanı her koşuda sıfırdan
oluşturulur; geliştirme verisine dokunulmaz.

> **OneDrive notu:** Test veritabanları proje dizini yerine işletim sistemi geçici
> dizininde (`%TEMP%/hr-self-service-tests/`) tutulur. Proje OneDrive altında olduğu için
> senkronizasyon, silinen veritabanı dosyasını geri getiriyordu; bu da testlerin bayat
> veriyle koşup yanlış sonuç vermesine yol açıyordu.

---

## 1.5 Dağıtım / paylaşım

Takımla test etmek için: **[DAGITIM.md](DAGITIM.md)**

Üç yol var — kendi makinenden ağa açmak (en hızlı), GitHub üzerinden kod
paylaşımı, veya kurum içi test sunucusu (Docker hazır).

Production modunda arayüz **API ile aynı port** üzerinden servis edilir; ikinci
bir servise veya ters proxy'ye gerek yoktur:

```bash
npm run gen:secret                 # JWT secret üret
npm run build                      # server + web
npm start                          # tek port (varsayılan 4000)
```

`NODE_ENV=production` iken uygulama güvensiz konfigürasyonla **açılmaz**:
örnek/kısa `JWT_SECRET`, `ALLOW_DEV_LOGIN=true`, veya demo modunda eksik/varsayılan
`SEED_PASSWORD` başlangıçta reddedilir.

---

## 2. Teknoloji

| Katman | Seçim | Neden |
| --- | --- | --- |
| Backend | Node + Express + TypeScript | Tek dil, hızlı iterasyon |
| ORM | Prisma | Tip güvenli sorgu + migration |
| Veritabanı | SQLite (dev) | Şema PostgreSQL / SQL Server'a taşınabilir yazıldı |
| Frontend | React + Vite + TypeScript | — |
| Stil | Tailwind CSS v4 | Bilgi yoğun, sade arayüz |
| Veri katmanı (web) | TanStack Query | Mutasyon sonrası tutarlı yenileme |
| Kimlik | JWT (yerel) | `AUTH_PROVIDER=oidc` ile Entra ID'ye geçilebilir |

**Taşınabilirlik notu:** Prisma şemasında `enum` ve native `Json` kullanılmadı; durum/tip
alanları `String` + TypeScript union + seed edilen referans tabloları (`StatusDefinition`,
`PriorityDefinition`) ile doğrulanıyor. Kurumsal ortama geçişte `datasource` sağlayıcısını
değiştirmek yeterlidir.

---

## 3. Veri Modeli

Spec'in istediği ayrım korunuyor:

```
TASARIM   WorkflowDefinition → WorkflowVersion → WorkflowStep → WorkflowAction
ÇALIŞAN   Request → WorkflowInstance → StepInstance → WorkflowActionLog → AuditEvent
```

**Kritik kural:** Çalışan bir kayıt her zaman kendi `WorkflowInstance.versionId`'si
üzerinden okunur. Motor hiçbir yerde `WorkflowDefinition.activeVersionId`'yi runtime'da
kullanmaz. Bu sayede yeni sürüm yayınlandığında açık kayıtlar etkilenmez.

Tablo grupları:

- **Kimlik:** `User`, `Role`, `UserRole`, `UserGroup`, `UserGroupMember`
- **Referans/konfigürasyon:** `StatusDefinition`, `PriorityDefinition`, `AppSetting`, `Holiday`
- **Kategori:** `RequestCategory`, `CategoryFormField`
- **Tasarım:** `WorkflowDefinition`, `WorkflowVersion`, `WorkflowStep`, `WorkflowAction`, `NotificationRule`
- **Runtime:** `Request`, `WorkflowInstance`, `StepInstance`, `WorkflowActionLog`, `AuditEvent`
- **Yan kayıtlar:** `Attachment`, `Comment`, `Notification`, `AdminOverride`, `RequestSequence`

---

## 4. Modül Yapısı

```
server/src/
  domain/        constants, errors, conditions (kosul degerlendirici), sla
  auth/          jwt, auth-context, middleware (requireAuth / requireRoles / requireAdmin)
  services/
    workflow-engine.ts        adim yurutme, aksiyon uygulama, ilerleme
    request.service.ts        talep yasam dongusu + gorunurluk filtresi
    assignee.service.ts       sorumlu cozumleme + yetki kontrolu
    workflow-admin.service.ts definition/version/step/action + validate + publish
    live-ops.service.ts       canli izleme + impact preview + override
    category-admin.service.ts kategori + form alanlari + ayarlar
    form.service.ts           dinamik alan dogrulama
    audit.service.ts          append-only audit yazma
    notification.service.ts   kural bazli bildirim (transaction disinda)
    report.service.ts         metrikler + CSV export
  routes/        auth, requests, catalog, admin
  jobs/          sla.job.ts (periyodik SLA degerlendirme)

web/src/
  api/           client (ApiError, stale/duplicate ayrimi), types
  auth/          AuthContext
  components/    Layout, ui (chip/modal/toast/pagination/disclosure),
                 DynamicForm, UserSearchInput, WorkflowProgress + Timeline
  pages/         MyRequests, NewRequest, RequestDetail, EditDraft, Tasks, Reports
  pages/admin/   WorkflowList, WorkflowVersions, WorkflowEditor, StepEditor,
                 ActionEditor, ConditionEditor, NotificationRulesEditor,
                 CategoryList, CategoryDetail, LiveOpsList, LiveOpsDetail, Settings
```

---

## 5. Güvenlik

- **Yetki her zaman sunucuda.** Frontend'deki gizleme yalnızca görünüm kolaylığıdır.
- Tüm liste/detay sorguları tek bir noktadan (`buildVisibilityWhere`) geçer:
  - Çalışan yalnızca kendi kayıtlarını (taslaklar dahil) görür.
  - Yönetici yalnızca kendisine yönlenmiş / geçmişte sorumlusu olduğu kayıtları görür.
  - İK, kategori sahipliği kendisine ait olan kayıtları görür.
  - Taslaklar yalnızca sahibine (ve Admin'e) görünür.
- Yetkisiz erişimde kaydın varlığı sızdırılmaz (403 yerine 404).
- **Admin, normal iş akışı aksiyonlarından muaf değildir.** Onaylamak yerine
  `ADMIN_OVERRIDE` kullanır; böylece müdahale audit'te ayırt edilebilir kalır.
- Serbest `status update` endpoint'i **yoktur**. Durum yalnızca konfigürasyonda tanımlı
  aksiyonlarla veya izin verilen admin override durumlarıyla değişir.
- Arayüz üzerinden doğrudan tablo/kolon düzenleme **yoktur**.
- Dosyalar web root altında değil ayrı `storage/` dizininde, rastgele adla tutulur;
  indirme her zaman talep yetkisi kontrolünden geçer.
- Kullanıcıya stack trace dönmez; teknik detay yalnızca sunucu log'una yazılır.

---

## 6. Veri Bütünlüğü

| Risk | Çözüm |
| --- | --- |
| Çift tıklama | `rowVersion` CAS (atomik) + `WorkflowActionLog(instanceId, idempotencyKey)` unique kısıtı |
| Bayat veri | Her mutasyon `expectedRowVersion` ister; uyuşmazsa `409 STALE_DATA` |
| Çift gönderim | `submit` yalnızca `DRAFT` + doğru rowVersion ile çalışır; ikinci istek 409 |
| Audit değiştirme | `AuditEvent` için update/delete servisi ve endpoint'i yok |
| Kayıt silme | Kategori/alan/dosya soft delete veya pasife alma; veri varsa silinmez |
| Transaction | Talep + instance + adım + audit tek transaction; bildirim commit sonrası |

`rowVersion` kontrolü aksiyon çözümlemesinden **önce** yapılır — aksi halde çift tıklamada
ikinci istek yanlış hata ("bu adımda böyle bir aksiyon yok") üretir.

---

## 7. İş Akışı Sürümleme

```
Personel Kartı v3 (Active)
   └── "Revizyon Oluştur" → v4 (Draft)   ← v3 hiç değişmez
         └── düzenle → doğrula → yayınla
               ├── v4 Active   → yeni talepler v4 kullanır
               └── v3 Superseded → v3 ile başlamış açık kayıtlar v3'te devam eder
```

- Yayınlanmış sürüm üzerinde her mutasyon `409` ile reddedilir (`assertDraft`).
- Aynı anda birden fazla taslak sürüm oluşturulamaz.
- Revizyon derin kopya alır; aksiyon hedefleri yeni sürümün adımlarına remap edilir.
- Otomatik migration **yoktur** (spec gereği).

### Publish öncesi doğrulama

Başlangıç adımı, bitiş adımı, sıra geçerliliği, hedefsiz aksiyon, approval adımı
sorumlusu, duplicate step/action kodu, geçersiz koşul, SLA tutarlılığı, aksiyonsuz ara
adım. `ERROR` varsa publish engellenir; `WARNING` engellemez.

---

## 8. Admin Live Operations

Süreç **tanımını** değiştiren ekranlardan tamamen ayrı. Dört müdahale:

| İşlem | Etki | SLA |
| --- | --- | --- |
| Sorumlu Değiştir | Adım aynı kalır, sorumlu değişir | Kesintisiz devam eder |
| Adımı Atla | Mevcut adım `SKIPPED`, sıradaki adım açılır | Yeni adım SLA'sı başlar |
| Hedef Adıma Taşı | Geçerli bir adıma taşır (geriye de) | Yeni adım SLA'sı başlar |
| Statü Değiştir | Yalnızca görünen durum | Değişmez |

Akış: **form → Impact Preview → confirmation → uygula**.

- Neden (`reasonCode`) zorunlu; "Diğer" seçilirse açıklama da zorunlu.
- Preview hiçbir değişiklik yapmaz (rowVersion'a dokunmaz, kayıt oluşturmaz).
- `confirmed: true` gönderilmeden uygulama reddedilir.
- Serbest metin statü kabul edilmez; yalnızca `allowAdminOverride = true` durumlar.
- Geriye taşımada geçmiş **silinmez**; hedef adım için yeni bir `StepInstance` oluşur.
- Her müdahale için `AdminOverride` kaydı + **iki** audit kaydı yazılır:
  - `visibility=ADMIN` → tam teknik detay (eski/yeni step, status, assignee, sürüm)
  - `visibility=USER` → "Süreç sistem yöneticisi tarafından … adımına yönlendirildi."

---

## 9. Business Decision Required

Spec'te net olmayan ve **uydurulmayan** konular. Hepsi konfigürasyonda; makul placeholder
değerlerle geldi, iş birimi kararıyla değiştirilmeli.

| Konu | Uygulanan placeholder | Nerede değişir |
| --- | --- | --- |
| SLA takvim modu (iş günü / resmî tatil) | `CALENDAR_DAYS` (takvim günü) | Sistem Ayarları → `sla.calendarMode`; sürüm bazında da ayarlanabilir. `BUSINESS_DAYS` için `Holiday` tablosu doldurulmalı |
| Yönetici onayı adımı SLA | 48 saat | İş akışı sürüm editörü → adım SLA ayarları |
| İK kontrol adımı SLA | 72 saat | Aynı yer |
| Kategori hedef süreleri | 48–120 saat (kategoriye göre) | Kategori ayarları (bilgilendirme amaçlı; süreyi adım SLA'sı belirler) |
| "Riskli" eşiği | Sürenin %80'i geçince | `sla.atRiskThresholdPercent` |
| Yönetici tanımsız/pasifse görev kime düşer | `HR_PROCESS_OWNER` | `assignee.fallbackRoleCode` (ayrıca audit'e `ASSIGNEE_FALLBACK` yazılır) |
| İK içi görev dağılımı | İK adımları rol/ekip havuzuna düşer | Kategori → Sorumlu Rol / Sorumlu Ekip |
| İK süreç sahibi görünürlüğü | İK'ya ait tüm kategorileri görür | `request.service.ts` içinde açıkça işaretli; kategori sahipliğiyle daraltılabilir |
| Hangi kategori hangi dokümanı ister | Tanımlanmadı | Kategori form alanlarına dosya/metin alanı eklenerek |
| Talep sahibi iptali | Kapanmamış her talepte serbest | — |
| Ek bilgi beklenirken SLA | Adım SLA'sı işlemeye devam eder | — |

---

## 10. Bilinen sınırlar / sonraki adımlar

- **Bildirim kanalları:** Yalnızca uygulama içi (`IN_APP`) gönderilir. `EMAIL` / `TEAMS`
  kuralları tanımlanabilir ancak gönderici entegrasyonu bağlanana kadar atlanır
  (`notification.enabledChannels`).
- **Kimlik sağlayıcı:** Yerel JWT. Entra ID/OIDC için `server/src/auth/` altındaki
  provider arayüzü genişletilir; `AUTH_PROVIDER=oidc`.
- **Kurumsal dizin senkronizasyonu:** Kullanıcı/yönetici bilgisi şu an seed'den geliyor.
  `User.externalId` ve `source` alanları Graph/AD senkronizasyonu için hazır.
- **Export:** CSV (Excel uyumlu, `;` ayırıcı + BOM). PDF export yapılmadı.
- **Git:** Depo `git init` ile başlatıldı ancak **hiç commit yapılmadı**; ilk commit
  sizin kontrolünüzde. `server/.env`, veritabanı dosyaları ve `storage/` dizini
  `.gitignore` ile hariç tutuldu.
- **PDF export:** Yapılmadı (CSV var).
- **Toplu işlem:** Admin için toplu statü/atama değişikliği bilinçli olarak yok
  (spec: "kontrolsüz toplu status değişikliği" yasak).

### Kurumsal ağ notu (TLS)

Kurumsal TLS incelemesi npm ve Prisma indirmelerini `SELF_SIGNED_CERT_IN_CHAIN` ile
kesiyordu. Çözüm: Windows güven deposu PEM olarak dışa aktarılıp `npm config set cafile`
ile tanımlandı (`C:\Users\<kullanıcı>\corp-ca-bundle.pem`). Prisma binary indirmeleri için
ayrıca şu değişkenin tanımlı olması gerekir:

```powershell
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', "$env:USERPROFILE\corp-ca-bundle.pem", 'User')
```

Bu ayar yapılmazsa `prisma generate` / `prisma db push` sertifika hatası verir.
