# HR Self Servis – Core Functional Specification

## 1. Amaç

Çalışanların İnsan Kaynakları hizmetlerine ilişkin taleplerini tek noktadan oluşturabildiği, takip edebildiği ve sonuçlandırabildiği kurumsal bir HR Self Servis uygulaması oluştur.

Temel akış:

**Talep Oluşturma → Routing → Onay/Kontrol → İşlem → Sonuçlandırma → Audit → Raporlama**

Bu doküman yalnızca son kullanıcı, yönetici ve İK tarafındaki temel işlevleri kapsar.

---

## 2. Roller

- **Employee:** Kendi taleplerini oluşturur ve takip eder.
- **Manager:** Kendisine yönlenen talepleri onaylar veya reddeder.
- **HR User:** Yetkili olduğu İK taleplerini işler.
- **HR Process Owner:** Süreç sahibi / üst seviye İK yetkilisi.
- **Admin:** Yönetim fonksiyonlarına erişir. Admin detayları ayrı dokümanlardadır.

Yetki kontrolü yalnızca UI'da değil backend seviyesinde de uygulanmalıdır.

---

## 3. Kullanıcı Bilgileri

Kullanıcı giriş yaptığında mümkünse kurumsal dizinden otomatik alınmalıdır:

- Ad Soyad
- Kullanıcı adı / e-posta
- Departman
- Ünvan
- Birinci Yönetici

Birinci yönetici kullanıcı tarafından manuel seçilmemelidir.

---

## 4. Başlangıç Talep Kategorileri

Minimum olarak:

- Bordro Talebi
- Çalışma Belgesi Talebi
- Personel Kart Talebi
- Steril Alan Bileklik Tanımlaması Talebi
- Kart Yetkisi Talebi
- Vize Evrakları Talebi
- Yıllık İzin İptali Talebi
- Yıllık İzin Bakiye Kontrolü Talebi
- Taşeron Personel Yemek Kaydı Talebi
- Sağlık Sigortası Talepleri

Kategori isimleri ve kategori davranışları kod içine gömülmemelidir.

---

## 5. Talep Oluşturma

### Çalışan Bilgileri
- Ad Soyad
- Departman
- Ünvan
- Birinci Yönetici

### Talep Bilgileri
- Talep Kategorisi
- Talep Tipi / Alt Tipi
- Açıklama
- Öncelik
- Beklenen Termin Tarihi
- Ek Dosyalar

Öncelik minimum:
- Düşük
- Orta
- Yüksek

Kategoriye göre dinamik alanlar desteklenebilmelidir.

Talep sahibi:
- Taslak kaydedebilmeli
- Taslağı düzenleyebilmeli
- İptal edebilmeli
- Gönderebilmelidir

---

## 6. Mevcut İK Routing Kuralı

Aşağıdaki talepler **Birinci Yönetici Onayı** gerektirir:

- Personel Kart Talebi
- Steril Alan Bileklik Tanımlaması Talebi
- Kart Yetkisi Talebi
- Yıllık İzin İptali Talebi
- Yıllık İzin Bakiye Kontrolü Talebi

Akış:

**Çalışan → Birinci Yönetici → İnsan Kaynakları → Sonuçlandırma**

Diğer kategoriler:

**Çalışan → İnsan Kaynakları → Sonuçlandırma**

Bu routing davranışı hard-code edilmemeli; admin konfigürasyonundan yönetilebilmelidir.

---

## 7. Durumlar ve Geçişler

Minimum durumlar:

- Taslak
- Gönderildi
- Yönetici Onayı Bekliyor
- İnsan Kaynakları Kontrolünde
- Reddedildi
- Onaylandı
- Tamamlandı
- İptal Edildi

İleride:
- İşleme Alındı
- Ek Bilgi Bekleniyor
- Çözüldü

gibi durumlar eklenebilmelidir.

Her durumdan her duruma geçişe izin verilmemelidir.

Normal kullanıcı akışında doğrudan serbest `status update` yapılmamalı; iş aksiyonları kullanılmalıdır:

- submitRequest
- approveRequest
- rejectRequest
- cancelRequest
- completeRequest
- requestMoreInfo

---

## 8. Yönetici Onayı

Yalnızca yönetici onayı gereken taleplerde çalışmalıdır.

Manager aksiyonları:
- Onayla
- Reddet

Red işleminde açıklama zorunlu olmalıdır.

Manager yalnızca kendisine yönlendirilmiş taleplerde işlem yapabilmelidir.

---

## 9. İK Kontrolü

HR User ilgili talepleri görebilmeli ve işleyebilmelidir.

İlk sürümde minimum:
- Onayla
- Reddet
- Sonuçlandır

Gerekirse:
- İşleme Al
- Ek Bilgi İste
- Talep Edene Geri Gönder
- Başka HR kullanıcısına ata

sonradan eklenebilir.

Red işleminde açıklama zorunlu olmalıdır.

---

## 10. Talep Takibi

Kullanıcı her zaman şu üç sorunun cevabını görebilmelidir:

1. Talebim nerede?
2. Şu anda kimde?
3. Bundan sonra ne olacak?

Talep detayında minimum:

- Talep No
- Kategori
- Durum
- Talep Eden
- Departman
- Öncelik
- Termin
- Şu Anda Kimde
- Oluşturma Tarihi
- Son Güncelleme
- Talep Detayları
- Ekler
- Workflow Progress
- Activity Timeline
- Onay Geçmişi

---

## 11. Workflow Progress

Yönetici onayı gereken taleplerde:

**Talep Oluşturuldu → Yönetici Onayı → HR Kontrol → Tamamlandı**

Yönetici onayı gerekmeyen taleplerde:

**Talep Oluşturuldu → HR Kontrol → Tamamlandı**

Geçmiş, mevcut ve gelecek adımlar görsel olarak ayırt edilmelidir.

---

## 12. Activity Timeline ve Audit

Her önemli işlem kayıt altına alınmalıdır:

- Talep oluşturma
- Gönderme
- Atama
- Yönlendirme
- Durum değişikliği
- Onay
- Red
- Yorum
- Doküman ekleme
- Sonuçlandırma

Audit kaydında minimum:

- Request ID
- Kullanıcı
- Rol
- İşlem
- Tarih/saat
- Eski değer
- Yeni değer
- Eski durum
- Yeni durum
- Açıklama

Audit kayıtları normal kullanıcılar tarafından değiştirilememeli veya silinememelidir.

---

## 13. Dosya ve Yorum

### Dosya
- Talebe güvenli şekilde bağlanmalı.
- Yetkisiz kullanıcı başka talebin dosyasına erişememeli.

### Yorum / Açıklama
- Workflow adımlarında açıklama eklenebilmeli.
- Red işleminde açıklama zorunlu olmalı.

---

## 14. Bildirim ve SLA

Event bazlı notification desteklenmelidir:

- Talep gönderildi
- Yönetici onayı bekliyor
- Yönetici onayladı/reddetti
- HR'a ulaştı
- Talep tamamlandı
- SLA yaklaşıyor/geçti

SLA değerleri kod içine gömülmemelidir.

Bildirim kanalları ileride:
- uygulama içi
- e-posta
- Teams

olarak genişletilebilmelidir.

---

## 15. Raporlama

Minimum filtreler:

- Talep No
- Talep Türü / Kategori
- Talep Eden
- Departman
- Yönetici
- Durum
- Öncelik
- Oluşturulma Tarihi
- Sonuçlandırma Tarihi
- SLA Durumu

Minimum metrikler:

- Toplam talep
- Açık talep
- Tamamlanan
- Reddedilen
- Kategori bazında talep
- Ortalama yanıt süresi
- Ortalama tamamlanma süresi
- SLA içinde / dışında tamamlananlar

Excel ve PDF export altyapısı düşünülebilir.

---

## 16. Güvenlik ve Veri Bütünlüğü

- Backend authorization zorunludur.
- API key, password, secret source code'a gömülmemelidir.
- Kritik kayıtlar kontrolsüz fiziksel olarak silinmemelidir.
- Audit kayıtları değiştirilememelidir.
- Duplicate submit/action engellenmelidir.
- Concurrent update veri kaybına yol açmamalıdır.
- Başarısız işlemler sessizce ignore edilmemelidir.
- Kullanıcıya teknik stack trace gösterilmemelidir.

---

## 17. Kritik Kabul Senaryoları

### A
Personel Kart Talebi:

**Employee → Manager → HR → Complete**

### B
Bordro Talebi:

**Employee → HR → Complete**

### C
Manager kendisine ait olmayan talebi onaylamaya çalışır:

**Yetki reddedilir.**

### D
Manager reddeder:

**Red nedeni zorunlu + audit + çalışan bildirimi**

### E
Kullanıcı aynı submit/action'a iki kez basar:

**Tek işlem oluşur.**

### F
İki kullanıcı aynı kaydı günceller:

**Eski veri yeni veriyi sessizce ezmez.**
