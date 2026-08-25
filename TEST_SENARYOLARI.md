# Test Senaryoları (elle kabul testi)

Uygulama: **http://localhost:5173** — Giriş ekranında sağdaki tablodan
**"Bu kullanıcı ile gir"** ile şifre girmeden kullanıcı değiştirebilirsin.
(Şifreyle girmek istersen parola: `Parola123!`)

> Kullanıcı değiştirmek için sağ üstten **Çıkış** → yeni kullanıcıyı seç.
> Aynı anda iki farklı kullanıcı olmak istersen ikinci kullanıcı için
> **gizli/incognito pencere** kullan (oturum tarayıcıda saklanıyor).

---

## 1. Ana akış — yönetici onaylı talep (Spec 01-A)

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 1.1 | `mehmet.ozturk` | Yeni Talep → Kategori: **Personel Kart Talebi** | Sağda "Bundan Sonra Ne Olacak?" panelinde **4 adım** görünür (Yönetici Onayı dahil) |
| 1.2 | | Çalışan Bilgileri bloğu | Ad/departman/ünvan/**birinci yönetici** dolu ve **düzenlenemez** |
| 1.3 | | Kart Tipi: **Kayıp / hasar** seç | Ekranda **"Kayıp / Hasar Beyanı"** alanı belirir (koşullu alan) |
| 1.4 | | Kart Tipi'ni **Yeni kart** yap | Beyan alanı kaybolur |
| 1.5 | | Konu yaz, **Gönder** | Talep detayına yönlenir |
| 1.6 | | Üstteki üç kart | **Nerede:** Yönetici Onayı Bekliyor · **Kimde:** Ahmet Yılmaz · **Sırada:** İnsan Kaynakları Kontrolü |
| 1.7 | | İş Akışı İlerlemesi | Talep Oluşturma ✓ · Yönetici Onayı ● (Şu anki adım) · sonrakiler soluk |
| 1.8 | | SLA çipi | "Süresinde" + kalan süre (~2 gün) |
| 1.9 | | Aksiyon butonları | **Yok** (adım kendisinde değil) |

### Yönetici tarafı

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 1.10 | `ahmet.yilmaz` | **Görevlerim** | Talep listede, "İşlem Yap" butonu var |
| 1.11 | | Talebi aç | **Onayla** ve **Reddet** butonları görünür |
| 1.12 | | **Onayla** → modal → onayla | Durum: İnsan Kaynakları Kontrolünde |
| 1.13 | | Onay Geçmişi | Ahmet Yılmaz / Onayla kaydı var |

### İK tarafı

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 1.14 | `elif.demir` | Görevlerim | Talep listede, adım "Ekip havuzu" etiketli |
| 1.15 | | Talebi aç | **Tamamla / Ek Bilgi İste / Reddet** butonları |
| 1.16 | | **Tamamla** | Durum: Tamamlandı · "Kimde": *İşlem beklenmiyor* |
| 1.17 | `mehmet.ozturk` | Bildirim çanı | Okunmamış bildirimler var, tıklayınca talebe gider |

---

## 2. Yönetici onayı gerekmeyen talep (Spec 01-B)

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 2.1 | `mehmet.ozturk` | Yeni Talep → **Bordro Talebi** | Sağ panelde **3 adım** (Yönetici Onayı yok) |
| 2.2 | | Dönem: `2026-07`, Format seç, Gönder | Durum doğrudan **İnsan Kaynakları Kontrolünde** |
| 2.3 | | İş Akışı İlerlemesi | "Yönetici Onayı" **üstü çizili** + *"Bu talep için gerekli değil"* |

Aynı iş akışı, aynı sürüm — fark yalnızca kategori ayarındaki "yönetici onayı gerekli"
kutusundan geliyor.

---

## 3. Yetki kontrolleri (Spec 01-C)

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 3.1 | `fatma.aydin` | Görevlerim | Mehmet'in talebi **görünmez** (astı değil) |
| 3.2 | `deniz.koc` | Taleplerim | Yalnızca **kendi** talepleri |
| 3.3 | `elif.demir` | — | Üst menüde **Yönetim** şeridi **yok** |
| 3.4 | `mehmet.ozturk` | Adres çubuğuna `/yonetim/is-akislari` yaz | "Bu ekrana erişim yetkiniz yok" |

**Backend kontrolü (asıl kanıt):** Aşağıdaki komut frontend'i tamamen atlayıp API'ye
doğrudan gider ve **403** dönmelidir:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"elif.demir","password":"Parola123!"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/admin/live/instances \
  -H "Authorization: Bearer $TOKEN"
```

---

## 4. Red + zorunlu açıklama (Spec 01-D)

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 4.1 | `ayse.celik` | Yeni Talep → **Kart Yetkisi Talebi** → alanları doldur → Gönder | Yönetici onayına düşer |
| 4.2 | `ahmet.yilmaz` | Talebi aç → **Reddet** → açıklamayı **boş bırak** → Uygula | *"Bu işlem için açıklama girilmesi zorunludur"* |
| 4.3 | | Açıklama yaz → Uygula | Durum: Reddedildi |
| 4.4 | `ayse.celik` | İşlem Geçmişi | "Reddedildi" kaydı + **red nedeni metni** görünür |
| 4.5 | | İş Akışı İlerlemesi | Kalan adımlar iptal edilmiş |

---

## 5. Çift tıklama tek işlem üretir (Spec 01-E)

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 5.1 | Yeni bir talebi yönetici onayına düşür | — |
| 5.2 | **Onayla** modalında "Onayla ve Uygula"ya **hızlıca 2-3 kez** bas | Buton ilk tıklamada devre dışı kalır; tek işlem uygulanır |
| 5.3 | Onay Geçmişi | **Tek** onay kaydı (iki değil) |

---

## 6. Bayat veri sessizce ezilmez (Spec 01-F)

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 6.1 | Bir talebi yönetici onayına düşür | — |
| 6.2 | `ahmet.yilmaz` ile talebi aç, **işlem yapma** (sekme açık kalsın) | — |
| 6.3 | **Gizli pencerede** `sistem.yonetici` ile aynı talepte Canlı Süreçler → **Sorumlu Değiştir** uygula | Müdahale başarılı |
| 6.4 | İlk sekmeye dön, eski ekranda **Onayla**'ya bas | Kırmızı uyarı: *"Kayıt siz görüntülerken başka bir kullanıcı tarafından güncellendi…"* ve ekran **kendini yeniler** |

---

## 7. Ek bilgi isteme döngüsü

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 7.1 | `mehmet.ozturk` | **Vize Evrakları Talebi** oluştur ve gönder | İK kontrolüne düşer |
| 7.2 | `elif.demir` | **Ek Bilgi İste** + açıklama | Durum: Ek Bilgi Bekleniyor |
| 7.3 | `mehmet.ozturk` | Talebi aç | "Kimde": **kendi adı** · tek buton: **Ek Bilgiyi Gönder** |
| 7.4 | | Açıklama yaz → gönder | Durum tekrar İnsan Kaynakları Kontrolünde |
| 7.5 | | İş Akışı İlerlemesi | İK adımı **tek satır** (mükerrer adım oluşmadı) |

---

## 8. Dosya ve yorum

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 8.1 | Talep sahibi | Ekler → dosya seç | Dosya listeye eklenir, tıklayınca iner |
| 8.2 | `elif.demir` | Yorum yaz + **"Dahili not"** işaretle → ekle | Yorum listede "Dahili not" etiketiyle |
| 8.3 | Talep sahibi | Yorumlar | Dahili not **görünmez** |
| 8.4 | Başka bir çalışan | Aynı talebin adresini `/talep/<id>` ile aç | "Talep bulunamadı veya görüntüleme yetkiniz yok" |

---

## 9. Yönetim — iş akışı sürümleme (Spec 02-B/C) ⭐ en kritik test

| # | Yapılacak (`sistem.yonetici`) | Beklenen |
| --- | --- | --- |
| 9.1 | Önce `mehmet.ozturk` ile bir **Personel Kart** talebi oluştur, **yönetici onayında bırak** | Talep detayında altta "İş akışı: … **v1**" |
| 9.2 | Yönetim → **İş Akışları** | "İK Standart Talep Akışı", Aktif Sürüm **v1**, "Açık Kayıt" sayısı > 0 |
| 9.3 | **Revizyon Oluştur** | Editör açılır, başlıkta **v2 · Taslak** |
| 9.4 | Aynı anda ikinci kez Revizyon Oluştur dene | *"…zaten yayınlanmamış bir taslak sürüm var"* |
| 9.5 | v2'de "İnsan Kaynakları Kontrolü" adımı → **Düzenle** → adı **"İK Kontrolü (v2)"** yap, SLA'yı **96** saate çek → Kaydet | Tabloda yeni ad ve süre |
| 9.6 | **Doğrula** | Hata yok |
| 9.7 | **Yayınla** → onay metnini oku → Yayınla | Bildirim: *"v2 yayınlandı. Önceki sürümdeki N açık kayıt kendi sürümünde devam ediyor."* |
| 9.8 | Sürümler ekranı | v1 = **"Yerine yenisi geçti"**, v2 = **Aktif**; v1'in "Açık Kayıt" sayısı **korunmuş** |
| 9.9 | **9.1'deki talebi aç** | Hâlâ **v1** · adım adı hâlâ **"İnsan Kaynakları Kontrolü"** (v2 adı değil) |
| 9.10 | O talebi yönetici ile onayla | v1 üzerinden sorunsuz ilerler |
| 9.11 | **Yeni** bir Personel Kart talebi oluştur | **v2** kullanır · adım adı **"İK Kontrolü (v2)"** |
| 9.12 | v1 sürümünü aç (Sürümler → v1 → Görüntüle) | Gri bilgi bandı: *"…salt okunurdur"* · "+ Adım Ekle" / Düzenle / Sil butonları **yok** |

---

## 10. Yönetim — doğrulama publish'i engeller (Spec 02-D)

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 10.1 | İş Akışları → **Yeni İş Akışı** (kod: `DENEME`, ad: Deneme) | 3 adımlık iskelet ile editör açılır |
| 10.2 | **+ Adım Ekle** → Tip: **Onay**, Sorumlu: **Belirli Rol**, rol **seçme** → Kaydet | *"Rol bazlı adım için rol seçilmelidir"* |
| 10.3 | "Tamamlandı" (Bitiş) adımını **Sil** → **Doğrula** | Kırmızı panel: *"Bitiş (End) adımı tanımlanmamış"* |
| 10.4 | **Yayınla** butonu | **Devre dışı** |
| 10.5 | Bitiş adımını geri ekle (Tip: Bitiş, durum: Tamamlandı) → Doğrula | Hata yok, Yayınla aktif |

---

## 11. Yönetim — kategori ve dinamik form (Spec 02-8/9)

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 11.1 | Yönetim → **Kategoriler** → *Bordro Talebi* → Düzenle | Ayarlar ekranı |
| 11.2 | **"Birinci yönetici onayı gerekli"** kutusunu **işaretle** | "Kategori güncellendi" |
| 11.3 | `mehmet.ozturk` ile **yeni** bir Bordro talebi oluştur | Artık **yönetici onayına** düşüyor (kod değişikliği olmadan) |
| 11.4 | Kutuyu geri kaldır | Sonraki talepler yine doğrudan İK'ya düşer |
| 11.5 | Aynı kategoride **+ Alan Ekle**: Etiket "Test Notu", Tip: Uzun metin, Zorunlu ✓ | Alan listeye eklenir |
| 11.6 | Yeni Bordro talebi oluştur | "Test Notu" alanı formda ve **zorunlu** |
| 11.7 | Alanı boş bırakıp Gönder | Alan altında kırmızı hata |
| 11.8 | Alanı **Sil** | Kullanıldıysa: *"…kullanıldığı için silinmedi, pasife alındı"* |

---

## 12. Canlı Süreçler + Admin müdahalesi (Spec 03) ⭐

| # | Yapılacak (`sistem.yonetici`) | Beklenen |
| --- | --- | --- |
| 12.1 | Yönetim → **Canlı Süreçler** | Tüm çalışan kayıtlar; Sürüm/Adım/Durum/Sorumlu/SLA kolonları |
| 12.2 | Eski sürümde koşan bir kayda bak | Sürüm çipi **sarı** (güncel sürüm değil) |
| 12.3 | Yönetici onayında bekleyen bir kaydın **Detay**'ını aç | Kayıt / İş Akışı / Adım Geçmişi / Audit blokları |
| 12.4 | Sağ panel: **Sorumlu Değiştir**, neden **seçmeden** "Etkiyi Göster" | Buton devre dışı (neden zorunlu) |
| 12.5 | Neden: **Diğer**, açıklama boş | Buton devre dışı (açıklama zorunlu) |
| 12.6 | Neden: **Kullanıcı sistemden ayrıldı**, yeni sorumlu: *Zeynep Kaya* → **Etkiyi Göster** | Etki özeti tablosu açılır: eski/yeni sorumlu, **"SLA kesintisiz devam edecek"**, bildirim etkisi |
| 12.7 | **Vazgeç** de, sonra kaydı yenile | **Hiçbir şey değişmemiş** (preview yazma yapmaz) |
| 12.8 | Tekrar Etkiyi Göster → **"Onaylıyorum, Uygula"** | "Müdahale uygulandı ve audit kaydı oluşturuldu" |
| 12.9 | Audit Kayıtları tablosu | **İki** `ADMIN_OVERRIDE` satırı: biri **Yönetici** (teknik, eski/yeni JSON), biri **Kullanıcı** görünürlüğünde |
| 12.10 | Müdahale Geçmişi | İşlem/neden/adım/durum/yapan/sürüm dolu |
| 12.11 | Talep sahibi ile aynı talebi aç → İşlem Geçmişi | **Tek** anlaşılır satır: *"Sürecin bu adımdaki sorumlusu sistem yöneticisi tarafından … olarak güncellendi."* Teknik JSON **görünmez** |
| 12.12 | `zeynep.kaya` ile giriş → Görevlerim | Talep artık **onda**, Onayla/Reddet yapabiliyor |

### Adım atlatma

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 12.13 | Yönetici onayında bir kayıtta **Adımı Atla** → neden: Yanlış yönlendirme → Etkiyi Göster | "Kapanacak Görev: Yönetici Onayı", "Oluşacak Görev: İK…", **"yeni adımın SLA süresi … başlatılacak"** |
| 12.14 | Uygula | Durum İK Kontrolünde |
| 12.15 | Adım Geçmişi | Yönetici Onayı = **Atlandı** / `ADMIN_OVERRIDE`; İK adımı aktif ve **SLA yeniden başlamış** |

### Hedef adıma taşıma (geriye)

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 12.16 | Yöneticisi onaylamış bir kayıtta **Hedef Adıma Taşı** → Yönetici Onayı (tekrar) | Uyarı: *"Kayıt geriye taşınıyor … geçmiş adım kayıtları silinmeyecek"* |
| 12.17 | Uygula → Adım Geçmişi | Yönetici Onayı **iki satır**: ilki Tamamlandı (Onayla), ikincisi Aktif |
| 12.18 | Onay Geçmişi | Eski onay kaydı **hâlâ duruyor** |

### Serbest statü girilemez

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 12.19 | **Statü Değiştir** → açılır liste | 7 durum listelenir (Yönetici Onayı Bekliyor, İK Kontrolünde, İşleme Alındı, Ek Bilgi Bekleniyor, Çözüldü, Tamamlandı, İptal Edildi). *Gönderildi* / *Taslak* / *Onaylandı* / *Reddedildi* **listede yok**; serbest metin alanı **yok** |
| 12.20 | *İşleme Alındı* seç → Etkiyi Göster | "Adım değişmediği için SLA kesintisiz devam edecek" |
| 12.21 | Uygula → sonra `elif.demir` ile aç | Adım ve sorumlu **aynı**, sadece durum değişti; İK hâlâ işlem yapabiliyor |

---

## 13. Raporlar

| # | Kim | Yapılacak | Beklenen |
| --- | --- | --- | --- |
| 13.1 | `zeynep.kaya` | Raporlar | Toplam/Açık/Tamamlanan/Reddedilen/İptal/Taslak sayıları |
| 13.2 | | Kategori ve durum kırılımları | Tablolar dolu |
| 13.3 | | **Excel (CSV) İndir** | Dosya iner; Excel'de Türkçe karakterler ve kolonlar düzgün |
| 13.4 | `mehmet.ozturk` | Raporlar | **Çok daha küçük** sayılar (yalnızca kendi kayıtları) |

---

## 14. Sistem ayarları

| # | Yapılacak | Beklenen |
| --- | --- | --- |
| 14.1 | Yönetim → **Sistem Ayarları** | SLA / Bildirim / Genel / Güvenlik grupları |
| 14.2 | `sla.atRiskThresholdPercent` = **10** yap, Kaydet | Açık taleplerde SLA çipi kısa sürede **"Riskli"**'ye döner (job 15 dk'da bir; hemen görmek için aşağıdaki komut) |
| 14.3 | Sayfa altı | **"İş Kararı Bekleyen Konular"** listesi — netleştirilmesi gereken maddeler |

SLA değerlendirmesini beklemeden tetiklemek için:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sistem.yonetici","password":"Parola123!"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
curl -s -X POST http://localhost:4000/api/admin/live/sla/evaluate -H "Authorization: Bearer $TOKEN"
```

---

## Otomatik testler

```bash
npm test --workspace server     # 57 entegrasyon testi (yukarıdaki senaryoların kod hâli)
npm run typecheck               # server + web tip kontrolü
```

Otomatik testler kendi ayrı veritabanını kullanır; ekranda gördüğün veriye dokunmaz.

## Veriyi sıfırlamak

Ekran verisi karıştıysa temiz başlangıca dön:

```bash
npm run db:reset --workspace server
```

> Bu komut geliştirme veritabanını **siler ve yeniden oluşturur**. Sunucu çalışıyorsa
> önce durdur (Ctrl+C), komutu çalıştır, sonra `npm run dev` ile tekrar başlat.
