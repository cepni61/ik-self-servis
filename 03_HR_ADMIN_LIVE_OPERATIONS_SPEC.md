# HR Self Servis – Admin Live Operations Specification

## 1. Amaç

Adminlerin production ortamındaki çalışan workflow kayıtlarını izleyebilmesini ve istisnai durumlarda kontrollü müdahale edebilmesini sağla.

Bu özellik workflow tasarımından ayrıdır.

- **Workflow Configuration:** Gelecekte çalışacak süreç tanımını değiştirir.
- **Live Operations:** Halihazırda çalışan belirli bir kayıt üzerinde işlem yapar.

---

## 2. Yetki

Bu ekranlara yalnızca **Admin** rolü erişebilmelidir.

Frontend'de gizlemek yeterli değildir.

Backend authorization zorunludur.

---

## 3. Canlı Süreçler Ekranı

Production'daki workflow instance'larını göster.

Minimum kolonlar:

- Request ID
- Talep Eden
- Kategori
- Workflow
- Workflow Version
- Current Step
- Current Status
- Current Assignee
- Started At
- Last Action
- SLA Status

Filtreler:

- Request ID
- Kullanıcı
- Workflow
- Workflow Version
- Kategori
- Status
- Step
- Assignee
- Tarih
- SLA Durumu

---

## 4. Canlı Kayıt Detayı

Admin müdahale etmeden önce minimum olarak görmelidir:

### Kayıt
- Request ID
- Talep Eden
- Kategori
- Oluşturma Tarihi

### Workflow
- Workflow Adı
- Workflow Version
- Current Step
- Current Status
- Current Assignee
- Previous Step
- Next Expected Step

### Operasyon
- SLA Status
- Step Start Time
- Last Action

### History
- Workflow Timeline
- Approval History
- Audit Trail

---

## 5. Admin Override Aksiyonları

İlk sürümde minimum:

### 1. Sorumlu Değiştir
Mevcut step'in assignee'sini kontrollü şekilde değiştir.

### 2. Adım Atlat
Mevcut adımı atlayıp tanımlı bir sonraki geçerli adıma ilerlet.

### 3. Hedef Adıma Taşı
Admin kaydı workflow içindeki geçerli bir adıma taşıyabilsin.

### 4. Statü Değiştir
Sadece izin verilen admin override statüleri arasından seçim yapılabilsin.

Admin'e serbest text status veya doğrudan database alanı edit ettirme.

Bu işlemler normal workflow aksiyonları değildir.

Hepsi ayrı bir:

**ADMIN_OVERRIDE**

business action olarak ele alınmalıdır.

---

## 6. Müdahale Nedeni

Her override işleminde neden zorunlu olmalıdır.

Önerilen seçenekler:

- Organizasyon değişikliği
- Yanlış yönlendirme
- Kullanıcı sistemden ayrıldı
- Teknik hata
- Süreç düzeltmesi
- İş kararı
- Diğer

Ek açıklama alanı bulunmalıdır.

---

## 7. Impact Preview

Override doğrudan uygulanmamalıdır.

Önce etki özeti göster.

Örnek:

- Request ID
- Mevcut Adım
- Mevcut Status
- Yapılacak İşlem
- Yeni Adım
- Yeni Status
- Kapatılacak görev
- Oluşturulacak görev
- Yeni sorumlu
- Bildirim etkisi
- SLA etkisi

Admin özeti gördükten sonra confirmation vermelidir.

---

## 8. Audit

Her admin override için minimum:

- Event Type = ADMIN_OVERRIDE
- Request ID
- Admin kullanıcı
- Tarih/saat
- İşlem tipi
- Eski step
- Yeni step
- Eski status
- Yeni status
- Eski assignee
- Yeni assignee
- Workflow Version
- Müdahale nedeni
- Açıklama

saklanmalıdır.

Bu audit kaydı değiştirilememeli veya silinememelidir.

---

## 9. Timeline

Admin müdahalesi normal kullanıcı timeline'ında uygun ve anlaşılır biçimde görünmelidir.

Örnek:

**Süreç sistem yöneticisi tarafından İnsan Kaynakları Kontrolü adımına yönlendirildi.**

Teknik detaylar admin audit ekranında bulunabilir.

---

## 10. Notification

Override sonucunda yeni bir sorumlu oluşuyorsa ilgili kişi bilgilendirilebilmelidir.

Notification gönderimi ana workflow transaction'ını bozmamalıdır.

---

## 11. SLA Davranışı

Adım değiştiğinde SLA davranışı belirsiz bırakılmamalıdır.

İlk sürümde basit bir kural uygulanabilir:

- Yeni step'e geçildiğinde ilgili step SLA'sı başlatılır.
- Sorumlu değişikliğinde aynı step SLA'sı devam eder.

Farklı davranış gerekiyorsa configurable yapılabilir.

---

## 12. Concurrency

Admin kayıt detayını açtıktan sonra başka kullanıcı işlem yapmış olabilir.

Override öncesi güncel version / rowVersion tekrar kontrol edilmelidir.

Kayıt değişmişse işlem uygulanmamalı ve admin güncel veriyi yeniden yüklemelidir.

---

## 13. Kesinlikle Yapılmayacaklar

- UI üzerinden direct database editing
- Arbitrary status string
- Audit silme/değiştirme
- Logsuz step skip
- Görünmez admin müdahalesi
- Kontrolsüz toplu status değişikliği
- Aktif workflow definition'ı override ekranından değiştirme
- Yeni workflow versiyonu yayınlandığında açık kayıtları otomatik migrate etme

---

## 14. Kritik Kabul Senaryoları

### A
Yönetici şirketten ayrılmış, talep bekliyor.

Admin:
**Sorumlu Değiştir → Reason → Preview → Confirm → Audit**

### B
Yanlış routing nedeniyle kayıt gereksiz approval step'inde.

Admin:
**Adım Atlat → Reason → Preview → Confirm → Yeni Step → Audit**

### C
Admin kayıt açıkken başka kullanıcı işlem yaptı.

**Concurrency kontrolü müdahaleyi engeller.**

### D
Admin serbest database status girmeye çalışır.

**Böyle bir özellik UI/API'da bulunmaz.**
