# HR Self Servis – Admin Workflow Configuration Specification

## 1. Amaç

Adminlerin yeni HR iş akışları oluşturabilmesini ve mevcut akışları kontrollü biçimde revize edebilmesini sağla.

Bu özellik bir genel amaçlı BPM / Camunda / Power Automate alternatifi değildir.

Amaç:

**HR süreçlerinin adım, sorumlu, routing, aksiyon ve SLA gibi temel davranışlarını kod değişikliği olmadan yönetebilmek.**

İlk sürümde drag-and-drop BPMN designer veya genel amaçlı no-code workflow motoru oluşturma.

---

## 2. Admin Workflow Yönetimi

Adminler:

- Yeni workflow oluşturabilmeli
- Workflow'u taslak kaydedebilmeli
- Mevcut workflow'u görüntüleyebilmeli
- Aktif workflow için yeni revizyon oluşturabilmeli
- Adımları düzenleyebilmeli
- Adım sırasını değiştirebilmeli
- Sorumlu rolü belirleyebilmeli
- Basit routing koşulları tanımlayabilmeli
- Aksiyonları belirleyebilmeli
- SLA tanımlayabilmeli
- Workflow'u doğrulayabilmeli
- Yayınlayabilmeli
- Pasife alabilmeli
- Geçmiş versiyonları görüntüleyebilmelidir

---

## 3. Workflow Veri Modeli

Temel ayrım:

**Workflow Definition → Workflow Version → Workflow Step → Transition**

Çalışan gerçek kayıtlar ise ayrı olarak:

**Workflow Instance → Step Instance → Action → Audit Event**

Yayınlanmış workflow üzerinde doğrudan değişiklik yapılmamalıdır.

---

## 4. Workflow Liste Ekranı

Minimum kolonlar:

- Workflow Adı
- Workflow Kodu
- İlgili Kategori
- Aktif Versiyon
- Durum
- Son Güncelleme
- Güncelleyen
- Aktif Kayıt Sayısı

Durumlar:
- Draft
- Active
- Inactive
- Archived

Aksiyonlar:
- Görüntüle
- Yeni Revizyon Oluştur
- Kopyala
- Versiyonları Gör
- Aktifleştir
- Pasife Al

---

## 5. Yeni Workflow / Revizyon Ekranı

İlk sürümde görsel BPM canvas yerine yapılandırılmış, detaylı bir editor kullan.

### Üst Bölüm
- Workflow Adı
- Workflow Kodu
- Kategori
- Versiyon
- Durum
- Açıklama

### Akış Adımları Tablosu

Örnek:

| Sıra | Adım | Tip | Sorumlu | Aksiyonlar | Koşul | SLA |
|---|---|---|---|---|---|---|
| 1 | Talep Oluşturma | Start | Employee | Gönder | - | - |
| 2 | Yönetici Onayı | Approval | Requester's Manager | Onayla / Reddet | Gerekliyse | 2 gün |
| 3 | HR Kontrol | Review | HR | Onayla / Reddet | - | 3 gün |
| 4 | Tamamla | End | HR | Tamamla | - | - |

Admin:
- + Adım Ekle
- Adım Sil
- ↑ / ↓ ile sırayı değiştir
- Adımı Düzenle

işlemlerini yapabilmelidir.

---

## 6. Adım Ayarları

Her adım için:

### Genel
- Adım Adı
- Adım Kodu
- Adım Tipi
- Açıklama
- Aktif / Pasif

### Sorumlu
- Employee
- Requester's Manager
- HR User
- HR Process Owner
- Belirli Rol
- Belirli Grup
- Gerekirse belirli kullanıcı

Kullanıcı isimlerini business logic içine hard-code etme.

### Aksiyonlar
Örn:
- Gönder
- Onayla
- Reddet
- Ek Bilgi İste
- Tamamla

Her action için:
- Action adı
- Action kodu
- Hedef adım
- Hedef durum
- Açıklama zorunlu mu?
- Confirmation gerekli mi?
- Bildirim gönderilecek mi?

---

## 7. Basit Routing / Koşul Yönetimi

İlk sürümde genel amaçlı rule engine geliştirme.

Admin temel koşulları yönetebilsin:

- equals
- not equals
- in
- not in
- is empty
- is not empty

Gerekirse:
- AND
- OR

desteklenebilir.

Örnek:

**Kategori IN [Personel Kartı, Kart Yetkisi] → Yönetici Onayı adımını kullan**

Koşullar structured configuration olarak saklanmalıdır.

Admin'e arbitrary code çalıştırma imkanı verilmemelidir.

---

## 8. Kategori Yönetimi

Admin kategori için minimum:

- Ad
- Kod
- Aktif / Pasif
- Bağlı Workflow
- Yönetici onayı gerekli mi?
- Varsayılan öncelik
- SLA
- Sorumlu rol / ekip
- Açıklama

tanımlayabilmelidir.

---

## 9. Form Konfigürasyonu

Kategori bazında minimum:

- Alan Adı
- Alan Tipi
- Zorunlu / Opsiyonel
- Read Only
- Hidden
- Default Value
- Basit validation
- Görünürlük koşulu

Alan tipleri:
- Text
- Long Text
- Number
- Date
- Dropdown
- Multi Select
- User
- File
- Checkbox

Bu özellik form engine'e dönüşecek kadar genişletilmemelidir; HR taleplerinin ihtiyaç duyduğu alanlarla sınırlı tutulmalıdır.

---

## 10. SLA Ayarları

Workflow veya step bazında:

- Hedef süre
- Reminder zamanı
- Escalation zamanı
- SLA aktif/pasif

tanımlanabilmelidir.

İş günü / resmi tatil gibi detaylar iş kararı gerektiriyorsa uydurulmamalı; configurable veya Business Decision Required olarak bırakılmalıdır.

---

## 11. Bildirim Ayarları

Temel event'ler:

- Step başladı
- Onaylandı
- Reddedildi
- HR'a yönlendirildi
- Tamamlandı
- SLA yaklaşıyor
- SLA geçti

Admin hangi event'te hangi rolün bilgilendirileceğini seçebilmelidir.

İlk sürümde gelişmiş notification template designer yapmak zorunlu değildir.

---

## 12. Workflow Validation

Publish öncesi minimum kontrol:

- Başlangıç adımı var mı?
- Bitiş adımı var mı?
- Adım sıraları geçerli mi?
- Hedefsiz action var mı?
- Approval adımının sorumlusu var mı?
- Duplicate step code var mı?
- Geçersiz routing koşulu var mı?

Kritik hata varsa publish engellenmelidir.

---

## 13. Workflow Versioning

Yayınlanmış workflow doğrudan değiştirilmemelidir.

Örnek:

`Personel Kartı v3 – Active`

Admin:

`Revizyon Oluştur`

dediğinde:

`Personel Kartı v4 – Draft`

oluşmalıdır.

v3 production'da çalışmaya devam etmelidir.

Versiyonda minimum:

- Version Number
- Status
- Created At
- Created By
- Published At
- Published By
- Change Description

tutulmalıdır.

---

## 14. Mevcut Açık Kayıtlar

Yeni workflow versiyonu yayınlandığında açık kayıtları otomatik olarak yeni versiyona taşıma.

Default:

**Running instances remain on the version they started with.**

Migration özelliği ilk sürüm kapsamına dahil edilmek zorunda değildir.

Gelecekte ihtiyaç olursa ayrı ve kontrollü bir özellik olarak ele alınmalıdır.

---

## 15. İlk Sürümde Bilinçli Olarak Yapılmayacaklar

- BPMN editor
- Drag-and-drop canvas zorunluluğu
- Generic node palette
- Genel amaçlı no-code rule engine
- Parallel branch engine
- Retry engine
- Generic timeout/exceptions engine
- Workflow simulation engine
- Version diff visualizer
- Otomatik workflow migration
- Arbitrary script/code node

Bunlar gerçek kullanım ihtiyacı oluşursa sonraki fazlarda değerlendirilmelidir.

---

## 16. Kabul Senaryoları

### A
Admin yeni workflow oluşturur:

**Draft → Validate → Publish**

### B
Admin aktif workflow'u değiştirmek ister:

**Active v3 değişmez → v4 Draft oluşur**

### C
v4 yayınlanır:

**v3 ile başlamış kayıtlar v3 üzerinde çalışmaya devam eder**

### D
Admin bir approval step oluşturur ama sorumlu belirlemez:

**Validation publish'i engeller**
