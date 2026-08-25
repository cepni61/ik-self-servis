# Spec Karşılama Durumu

Üç spec dokümanının madde bazında karşılanma durumu ve karşılık gelen kod konumu.

Durum: **✅** tamam · **◐** temel seviye tamam, genişletilebilir · **⛔** bilinçli olarak kapsam dışı

---

## 01 — HR Self Servis Core

| § | Gereksinim | Durum | Nerede |
| --- | --- | --- | --- |
| 2 | Employee / Manager / HR User / HR Process Owner / Admin rolleri | ✅ | `Role` + `UserRole` seed; `auth/middleware.ts` |
| 2 | Yetki kontrolü backend seviyesinde | ✅ | `requireRoles`, `buildVisibilityWhere`, `canActOnStep` |
| 3 | Kullanıcı bilgileri dizinden; yönetici manuel seçilmez | ✅ | `User.managerId`; talep formunda salt okunur gösterim |
| 4 | 10 başlangıç kategorisi, kod içine gömülmemiş | ✅ | `prisma/seed.ts` → `RequestCategory` |
| 5 | Talep oluşturma + kategoriye göre dinamik alanlar | ✅ | `NewRequestPage`, `CategoryFormField`, `form.service.ts` |
| 5 | Öncelik Düşük/Orta/Yüksek | ✅ | `PriorityDefinition` |
| 5 | Taslak kaydet / düzenle / iptal / gönder | ✅ | `createRequest`, `updateDraft`, `cancelRequest`, `submitRequest` |
| 6 | Yönetici onayı gerektiren kategoriler; hard-code değil | ✅ | `RequestCategory.requiresManagerApproval` + koşullu adım |
| 7 | Durumlar ve kontrollü geçiş | ✅ | `StatusDefinition` seed; geçiş yalnızca tanımlı aksiyonla |
| 7 | İş aksiyonları (submit/approve/reject/cancel/complete/requestMoreInfo) | ✅ | `workflow-engine.ts`; serbest status endpoint'i yok |
| 8 | Yönetici onayı; redde açıklama zorunlu; yalnızca kendisine yönlenen | ✅ | `WorkflowAction.commentRequired`, `canActOnStep` |
| 9 | İK: Onayla / Reddet / Sonuçlandır (+ Ek Bilgi İste) | ✅ | Seed edilen `HR_KONTROL` adımı aksiyonları |
| 10 | "Talebim nerede / kimde / sırada ne var" | ✅ | `RequestDetailPage` üst üç kart; `getProgress()` |
| 10 | Talep detayı minimum alanları | ✅ | `getRequestDetail()` |
| 11 | Workflow progress; geçmiş/mevcut/gelecek ayrımı | ✅ | `WorkflowProgress.tsx` (`phase`: past/current/future/skipped) |
| 12 | Activity timeline + audit (min. alanlar) | ✅ | `AuditEvent`, `audit.service.ts`, `Timeline.tsx` |
| 12 | Audit değiştirilemez/silinemez | ✅ | Servis ve API'de update/delete yok |
| 13 | Dosya güvenli bağlanır; başka talebin dosyasına erişilemez | ✅ | `attachment.service.ts` → yetki zinciri + test |
| 13 | Yorum; redde açıklama zorunlu | ✅ | `Comment` + `commentRequired` |
| 14 | Event bazlı bildirim; SLA kod içine gömülmemiş | ✅ | `NotificationRule`, adım bazlı `slaHours` |
| 14 | Kanal genişletilebilirliği (uygulama içi / e-posta / Teams) | ◐ | Kanal modellendi; yalnızca `IN_APP` gönderiliyor |
| 15 | Raporlama filtreleri ve metrikleri | ✅ | `report.service.ts`, `ReportsPage` |
| 15 | Excel/PDF export altyapısı | ◐ | CSV (Excel uyumlu) var; PDF yok |
| 16 | Güvenlik ve veri bütünlüğü maddeleri | ✅ | README §5–6 |
| 17-A | Personel Kart: Employee → Manager → HR → Complete | ✅ | `admin.test.ts` / `api.test.ts` |
| 17-B | Bordro: Employee → HR → Complete | ✅ | `api.test.ts` |
| 17-C | Başkasının talebini onaylama → reddedilir | ✅ | `api.test.ts` |
| 17-D | Red: açıklama zorunlu + audit + bildirim | ✅ | `api.test.ts` |
| 17-E | Çift tıklama → tek işlem | ✅ | `api.test.ts` (eşzamanlı 2 istek) |
| 17-F | Eşzamanlı güncelleme → sessiz ezme yok | ✅ | `api.test.ts` |

---

## 02 — Admin Workflow Configuration

| § | Gereksinim | Durum | Nerede |
| --- | --- | --- | --- |
| 2 | Oluştur / taslak / görüntüle / revize / yayınla / pasife al / geçmiş | ✅ | `workflow-admin.service.ts`, `WorkflowListPage` |
| 3 | Definition → Version → Step → Transition ayrımı | ✅ | Prisma şeması (transition = `WorkflowAction.targetStep*`) |
| 3 | Yayınlanmış workflow doğrudan değiştirilemez | ✅ | `assertDraft()` — her mutasyonda |
| 4 | Liste ekranı kolonları + aksiyonlar | ✅ | `WorkflowListPage` (aktif kayıt sayısı dahil) |
| 5 | Yapılandırılmış editor (canvas değil) | ✅ | `WorkflowEditorPage` — adım tablosu |
| 5 | + Adım Ekle / Sil / ↑ / ↓ / Düzenle | ✅ | `addStep`, `deleteStep`, `moveStep`, `updateStep` |
| 6 | Adım ayarları (genel / sorumlu / aksiyonlar) | ✅ | `StepEditor`, `ActionEditor` |
| 6 | Sorumlu tipleri (7 tip) | ✅ | `ASSIGNEE_TYPE`, `assignee.service.ts` |
| 6 | Action: hedef adım/durum, açıklama zorunlu, confirmation, bildirim | ✅ | `WorkflowAction` alanları |
| 7 | Basit koşul (6 operatör, AND/OR), arbitrary kod yok | ✅ | `domain/conditions.ts`, `ConditionEditor` |
| 7 | Koşullar structured configuration olarak saklanır | ✅ | `WorkflowStep.conditionJson` (doğrulanarak) |
| 8 | Kategori yönetimi (min. alanlar) | ✅ | `CategoryDetailPage`, `category-admin.service.ts` |
| 9 | Form konfigürasyonu (9 alan tipi, validation, görünürlük koşulu) | ✅ | `CategoryFormField`, `form.service.ts` |
| 10 | SLA ayarları (hedef / reminder / escalation / aktif) | ✅ | Adım SLA alanları; `sla.job.ts` |
| 10 | İş günü / tatil belirsizliği uydurulmadı | ✅ | `slaCalendarMode` + `Holiday` + README §9 |
| 11 | Bildirim ayarları (event → rol) | ✅ | `NotificationRulesEditor` |
| 12 | Publish öncesi doğrulama (7 kontrol) | ✅ | `validateVersion()` — 11 kontrol |
| 13 | Versioning; v3 değişmez, v4 draft oluşur | ✅ | `createRevision()`, `publishVersion()` |
| 13 | Versiyon meta alanları | ✅ | `WorkflowVersion` |
| 14 | Açık kayıtlar otomatik taşınmaz | ✅ | Motor `instance.versionId` kullanır; test ile doğrulandı |
| 15 | BPMN, canvas, generic node, rule engine, parallel branch, retry, simulation, diff, auto-migration, script node | ⛔ | Bilinçli olarak yapılmadı |
| 16-A | Draft → Validate → Publish | ✅ | `admin.test.ts` |
| 16-B | Aktif v3 değişmez, v4 Draft oluşur | ✅ | `admin.test.ts` |
| 16-C | v3 ile başlayan kayıtlar v3'te devam eder | ✅ | `admin.test.ts` |
| 16-D | Sorumlusu olmayan approval adımı publish'i engeller | ✅ | `admin.test.ts` (girişte reddedilir + publish gate) |

---

## 03 — Admin Live Operations

| § | Gereksinim | Durum | Nerede |
| --- | --- | --- | --- |
| 1 | Configuration'dan tamamen ayrı ekran | ✅ | `LiveOpsListPage` / `LiveOpsDetailPage` |
| 2 | Yalnızca Admin; backend zorunlu | ✅ | `requireAdmin` + `assertAdmin()` (iki kat) |
| 3 | Canlı süreçler listesi kolonları | ✅ | `listLiveInstances()` |
| 3 | Filtreler (10 filtre) | ✅ | `LiveOpsFilters` |
| 4 | Kayıt / workflow / operasyon / history blokları | ✅ | `getLiveInstanceDetail()` |
| 5 | Sorumlu Değiştir / Adım Atlat / Hedef Adıma Taşı / Statü Değiştir | ✅ | `applyOverride()` |
| 5 | ADMIN_OVERRIDE ayrı business action; normal status update değil | ✅ | `AdminOverride` tablosu + ayrı audit tipi |
| 5 | Serbest text status / DB alanı edit yok | ✅ | `allowAdminOverride` beyaz listesi; test ile doğrulandı |
| 6 | Müdahale nedeni zorunlu (7 seçenek + açıklama) | ✅ | `OVERRIDE_REASONS`; "Diğer"de açıklama zorunlu |
| 7 | Impact Preview (11 bilgi) sonra confirmation | ✅ | `previewOverride()` + `confirmed: true` zorunlu |
| 8 | Audit min. alanları; değiştirilemez | ✅ | `AdminOverride` + `AuditEvent(ADMIN_OVERRIDE)` |
| 9 | Kullanıcı timeline'ında anlaşılır görünüm | ✅ | İki audit kaydı: `visibility=USER` / `ADMIN` |
| 10 | Bildirim ana transaction'ı bozmaz | ✅ | Commit sonrası `dispatchNotifications()`, try/catch |
| 11 | SLA davranışı net: adım değişince yeniden başlar, sorumlu değişince devam | ✅ | `applyOverride()` + preview `slaImpact` metni |
| 12 | Concurrency: rowVersion tekrar kontrol edilir | ✅ | Transaction içinde CAS; test ile doğrulandı |
| 13 | Yapılmayacaklar listesi | ✅ | Hiçbiri uygulanmadı (README §5) |
| 14-A | Yönetici ayrıldı → Sorumlu Değiştir → Reason → Preview → Confirm → Audit | ✅ | `admin.test.ts` |
| 14-B | Yanlış routing → Adım Atlat → Preview → Confirm → Yeni Step → Audit | ✅ | `admin.test.ts` |
| 14-C | Kayıt değişmişse concurrency engeller | ✅ | `admin.test.ts` |
| 14-D | Serbest DB status girme özelliği yok | ✅ | `admin.test.ts` (2 test) |

---

## Sonraki fazlar için öneri sırası

1. **Kurumsal kimlik + dizin** — OIDC (Entra ID) girişi ve Graph üzerinden
   kullanıcı/yönetici senkronizasyonu. Şu an tek yapay bağımlılık burada.
2. **E-posta bildirimi** — `notification.service.ts` içinde kanal gönderici arayüzü
   hazır; SMTP/Graph gönderici eklenip `notification.enabledChannels` açılır.
3. **SLA iş günü modu** — İş birimi kararı geldiğinde `Holiday` tablosu doldurulup
   `sla.calendarMode = BUSINESS_DAYS` yapılır. Hesaplama kodu hazır ve test edilebilir.
4. **Raporlama derinleşmesi** — PDF export, kayıtlı filtre, departman kırılımlı SLA.
5. **İK operasyon kolaylıkları** — "Bana ata", HR kullanıcıları arası devretme,
   toplu görüntüleme (toplu statü değişikliği spec gereği hariç).
