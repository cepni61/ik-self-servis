# Dağıtım / Paylaşım Rehberi

Takım arkadaşlarınla test etmek için üç yol var. Aşağıdakiler **en hızlı → en
kurumsal** sırada.

> ## ⚠️ Bu kurulum bir DEMO'dur
>
> Paylaşılan kurulumda 11 örnek kullanıcı **ortak bir parola** ile oluşturulur
> (`DEMO_MODE=true`). Bu bilinçli bir tercih — takımın rol değiştirerek test
> edebilmesi için gerekli. Sonucu:
>
> - **Gerçek personel verisi girilmemelidir.**
> - **İnternete açık bir adrese konulmamalıdır.** Kurum ağı içinde kalmalı.
> - Gerçek kullanıcılarla ilerlenecekse `DEMO_MODE=false` + kurumsal kimlik
>   sağlayıcı (Entra ID/OIDC) gerekir — bu henüz yapılmadı (README §10).

---

## Seçenek 1 — Kendi makinende ağa aç (en hızlı, 5 dakika)

Takım aynı kurum ağındaysa en pratik yol. Ekstra altyapı gerekmez.

```bash
# 1) Rastgele bir JWT secret üret
npm run gen:secret

# 2) server/.env.production dosyasını oluştur (aşağıdaki şablon)
# 3) Derle + veritabanını hazırla
npm run build
cd server
$env:NODE_ENV="production"; npx prisma db push --skip-generate   # PowerShell
node dist/prisma/seed.js

# 4) Başlat
npm start        # repo kökünden
```

`server/.env.production` şablonu:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL="file:./prod.db"
JWT_SECRET=<npm run gen:secret çıktısı>
ALLOW_DEV_LOGIN=false
DEMO_MODE=true
SEED_PASSWORD=<takıma vereceğin ortak parola, min 8 karakter>
STORAGE_DIR=./storage
```

Sonra makinenin IP'sini bul ve paylaş:

```powershell
ipconfig | Select-String IPv4
# Takım: http://<senin-ip>:4000
```

**Windows Firewall** ilk seferinde soracak; sormazsa (yönetici PowerShell):

```powershell
New-NetFirewallRule -DisplayName "IK Self Servis (test)" -Direction Inbound `
  -LocalPort 4000 -Protocol TCP -Action Allow -Profile Domain
```

| Artı | Eksi |
| --- | --- |
| Altyapı/onay gerekmez | Yalnızca bilgisayarın açıkken erişilebilir |
| Tek port, tek komut | IP değişirse adres değişir |
| Veri kurum ağından çıkmaz | Uyku moduna girerse kesilir |

---

## Seçenek 2 — GitHub (kod paylaşımı) + herkes kendi makinesinde çalıştırır

Kalıcı bir adres vermez ama kodu paylaşmanın doğru yolu ve kod inceleme için en
uygunu.

### Depoyu hazırla

```bash
git add -A
git commit -m "İK Self Servis: ilk sürüm"
```

Sonra GitHub'da **private** (veya kurum organizasyonunda internal) bir depo aç ve:

```bash
git remote add origin https://github.com/<kullanici>/<depo>.git
git branch -M main
git push -u origin main
```

> `.gitignore` şunları hariç tutar: `server/.env*` (secret'lar), veritabanı
> dosyaları, `storage/`, `node_modules`, build çıktıları. Yalnızca `.env*.example`
> dosyaları depoya girer. Push öncesi `git status` ile doğrulayın.

### Takım arkadaşının yapacağı (README ile aynı)

```bash
git clone <depo-url> && cd <depo>
npm install
cp server/.env.example server/.env
npm run db:reset --workspace server
npm run dev            # http://localhost:5173
```

**Kurumsal ağ engeli:** `npm install` ve Prisma indirmeleri TLS incelemesi
nedeniyle `SELF_SIGNED_CERT_IN_CHAIN` ile kesilebilir. README'nin sonundaki
"Kurumsal ağ notu (TLS)" bölümünü paylaşın — iki komutla çözülüyor.

| Artı | Eksi |
| --- | --- |
| Kod incelemesi, sürüm geçmişi | Herkes kurulum yapmak zorunda |
| Sunucu gerekmez | Herkesin verisi ayrı (ortak test yapılamaz) |
| Kurumsal politikaya en uygun | Node.js + TLS ayarı gerekiyor |

**Not:** Depo public yapılmamalı. Bu kod kurum içi bir İK sürecini modelliyor;
kategori/rol/akış isimleri iş süreci bilgisidir.

---

## Seçenek 3 — Kurum içi test sunucusu (kalıcı adres)

Gerçek bir test ortamı için doğru yol. Docker varsa tek komut:

```bash
# Sunucuda
echo "JWT_SECRET=$(openssl rand -base64 48)" > .env
echo "SEED_PASSWORD=<ortak-parola>" >> .env
docker compose up -d --build
# http://<sunucu>:4000
```

`docker-compose.yml` ve `Dockerfile` hazır. Veri `hrss-data` volume'ünde kalıcı
(veritabanı + yüklenen dosyalar). Yeniden başlatma güvenli — açılış adımları
idempotent.

> **Bu imaj bu makinede test edilemedi** (Docker kurulu değil). İlk `docker
> compose up` sırasında hata çıkarsa çıktıyı paylaşmanız yeterli.

Docker yoksa sunucuya doğrudan kurulum, Seçenek 1'deki adımlarla aynı — ek olarak
bir servis tanımı (systemd / Windows Service / IIS reverse proxy) gerekir.

Azure App Service / Container Apps da kullanılabilir; kurum aboneliği altında ve
sadece kurum ağına açık (private endpoint / IP kısıtı) yapılandırılmalıdır.

| Artı | Eksi |
| --- | --- |
| Kalıcı adres, herkes aynı veriyi görür | Sunucu + IT onayı gerekir |
| Gerçek test ortamı davranışı | Kurulum eforu |

---

## Hangisini seçmeli?

- **"Bugün göstermek istiyorum"** → Seçenek 1
- **"Kodu da paylaşmak/incelemek istiyorum"** → Seçenek 2
- **"Kalıcı test ortamı kuracağız"** → Seçenek 3

Seçenek 1 ve 2 birlikte de kullanılabilir: kod GitHub'da dursun, demo senin
makinenden yayınlansın.

---

## Güvenlik ağı: uygulama güvensiz konfigürasyonla AÇILMAZ

`NODE_ENV=production` iken başlangıçta şunlar denetlenir ve ihlal varsa uygulama
**başlamaz** (`assertProductionSafety`):

| Kontrol | Neden |
| --- | --- |
| `JWT_SECRET` örnek değer veya < 32 karakter | Token taklit edilebilir |
| `ALLOW_DEV_LOGIN=true` | Parolasız Admin girişi açar |
| `DEMO_MODE=true` iken `SEED_PASSWORD` boş / < 8 karakter / `Parola123!` | Bilinen parolayla açık kurulum |

Ayrıca `NODE_ENV=production` ise ortam dosyası olarak önce `.env.production`
aranır; böylece bir sunucuya yanlışlıkla kopyalanan geliştirme `.env` dosyası
devreye girmez.

Doğrulandı: yukarıdaki üç kontrolün her biri uygulamayı gerçekten durduruyor;
geçerli konfigürasyonda tek port üzerinden arayüz + API çalışıyor, parolasız
giriş kapalı ve varsayılan parola reddediliyor.

---

## Dağıtım sonrası kontrol listesi

```bash
curl http://<adres>/api/health           # {"status":"ok"}
curl http://<adres>/api/auth/dev-users   # {"enabled":false,...}  ← parolasız giriş KAPALI
```

- [ ] Ana sayfa açılıyor, giriş ekranında **kullanıcı tablosu görünmüyor** (demo giriş kapalı)
- [ ] Ortak parola ile giriş çalışıyor, `Parola123!` reddediliyor
- [ ] Çalışan kullanıcıda **Yönetim** menüsü görünmüyor
- [ ] Bir talep oluşturulup yönetici onayına düşüyor
- [ ] Takıma ortak parola **ayrı bir kanaldan** iletildi (kod deposunda değil)
