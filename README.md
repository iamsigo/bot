# ربات پشتیبانی فارسی Telegram روی Cloudflare Workers — بدون سرویس خارجی

این پروژه در زمان اجرا فقط از Telegram و Cloudflare استفاده می‌کند:

- **Telegram Bot API** برای پیام‌ها و relay
- **Cloudflare Worker** برای منطق برنامه و Mini App
- **Cloudflare D1** برای داده‌های رابطه‌ای
- **Cloudflare KV** فقط برای rate limiting کوتاه‌مدت

هیچ VPS، Node server، Firebase، Supabase، Redis، سرویس Auth، هاست جداگانه یا دیتابیس خارجی لازم نیست.

## پنل مدیریت کجاست؟

پنل یک **Telegram Mini App** است که مستقیماً داخل Telegram باز می‌شود. مدیر از دکمه «پنل مدیریت» در پایین چت Bot یا دستور `/panel` وارد آن می‌شود.

Mini App در همان Cloudflare Worker سرو می‌شود؛ URL جداگانه و سرور جدا ندارد.

احراز هویت نیز با `Telegram.WebApp.initData` انجام می‌شود و Worker امضای Telegram را با `crypto.subtle` بررسی می‌کند. هیچ پسورد، session cookie یا سرویس احراز هویت خارجی وجود ندارد.

## امکانات اصلی

- دریافت پیام‌های متداول Telegram و ثبت گفتگو در D1
- relay مدیا با `copyMessage`؛ فایل‌های دریافتی از Telegram برای relay دانلود نمی‌شوند
- Claim / Release گفتگو
- پاسخ مدیر با Reply مستقیم در Telegram
- پاسخ مدیر از Mini App داخل Telegram
- ارسال متن و مدیا از Mini App
- مسدود/فعال‌کردن کاربر
- مدیر ارشد از `SUPER_ADMIN_IDS`
- دعوت یک‌بارمصرف مدیر با Deep Link
- داشبورد، گفتگوها، پاسخ‌های آماده، مدیران، اطلاع‌رسانی، آمار و تنظیمات داخل Mini App
- جستجو، اولویت و برچسب گفتگو
- خروجی CSV گفتگو
- broadcast به صورت batch
- rate limiting با KV
- idempotency برای `update_id`
- health check
- RTL فارسی و پشتیبانی از theme تلگرام

## رایگان بودن و سقف‌ها

این پروژه هیچ سرویس پولی دیگری لازم ندارد، اما Free Tier سقف دارد. در حال حاضر Workers Free دارای 100,000 request در روز و 10ms CPU برای هر request است. D1 Free دارای 5 میلیون row-read و 100 هزار row-write در روز و حداکثر 500MB برای هر database است. KV Free نیز 100,000 read و 1,000 write در روز دارد.

از **1 سپتامبر 2026**، D1 در Free Tier بعد از عبور از سقف روزانه read/write درخواست‌های بعدی را تا reset رد می‌کند؛ داده‌ها حذف نمی‌شوند. این پروژه تلاش می‌کند مصرف را پایین نگه دارد، ولی هیچ پروژه‌ای نمی‌تواند محدودیت Cloudflare را حذف کند.

## ساختار

```text
src/
  index.js
  telegram/
    api.js
    webhook.js
  handlers/
    userHandler.js
    adminHandler.js
    commandHandler.js
  admin-panel/
    routes.js
  db/
    queries.js
    schema.sql
  utils/
    telegramWebAppAuth.js
    rateLimit.js
    dates.js
    i18n.js
migrations/
  0001_initial.sql
  0002_broadcast_batches.sql
wrangler.toml
package.json
.dev.vars.example
```

## راه‌اندازی

### 1. ساخت Bot

در `@BotFather` یک Bot بسازید و token را بگیرید.

### 2. نصب ابزار deployment

این فقط برای deploy است؛ پس از deploy، خود برنامه روی Cloudflare اجرا می‌شود.

```bash
npm install
npx wrangler login
```

### 3. ساخت D1

```bash
npx wrangler d1 create telegram-support
```

`database_id` را در `wrangler.toml` بگذارید.

### 4. ساخت KV

```bash
npx wrangler kv namespace create TELEGRAM_SUPPORT_KV
```

`id` را در `wrangler.toml` بگذارید.

### 5. تنظیم آدرس همان Worker

در `wrangler.toml`:

```toml
APP_URL = "https://YOUR-WORKER.workers.dev"
BOT_USERNAME = "your_bot_username"
```

این همان Worker است که Bot، API و Mini App را سرو می‌کند.

### 6. Secretها

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put SUPER_ADMIN_IDS
```

مثال:

```text
123456789,987654321
```

`PANEL_SESSION_SECRET` دیگر وجود ندارد و لازم نیست.

### 7. Migration

```bash
npx wrangler d1 migrations apply telegram-support --remote
```

### 8. Deploy

```bash
npx wrangler deploy
```

### 9. اتصال Telegram به Worker

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR-WORKER.workers.dev/telegram/webhook","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["message","callback_query"]}'
```

## اولین مدیر ارشد

1. Telegram ID خودتان را در `SUPER_ADMIN_IDS` قرار دهید.
2. deploy کنید.
3. به Bot پیام `/start` بدهید.
4. Worker حساب را در D1 به عنوان `super_admin` ثبت/فعال می‌کند.
5. Bot برای همان چت Mini App menu button را تنظیم می‌کند.
6. «پنل مدیریت» را داخل Telegram باز کنید.

برای مدیران معمولی، مدیر ارشد از `/invite` یا بخش «مدیران» در Mini App لینک دعوت می‌سازد. لینک 24 ساعت اعتبار دارد و یک بار قابل استفاده است.

## احراز هویت Mini App

- `/app` همان Mini App است.
- APIهای مدیریتی فقط `Authorization: tma <initData>` معتبر Telegram را قبول می‌کنند.
- `initDataUnsafe` استفاده نمی‌شود.
- هر درخواست API در همان Worker اعتبارسنجی می‌شود.
- هیچ login page مستقل، password یا session cookie وجود ندارد.

## مدیا

برای پیام‌های کاربر، Worker فقط file_id و metadata را ذخیره می‌کند و relay را با Bot API و `copyMessage` انجام می‌دهد.

برای ارسال مدیا از Mini App، فایل به همان Worker فرستاده می‌شود و Worker آن را مستقیماً به Bot API می‌دهد. هیچ سرور واسطی وجود ندارد.

## دستورات مدیر

```text
/start
/panel
/stats
/invite
/admins
/away
/help
```

استفاده روزمره از Mini App داخل Telegram توصیه می‌شود.

## Health check

```text
GET https://YOUR-WORKER.workers.dev/health
```

## نکته مهم

Cloudflare Free به معنی «بدون هزینه تا سقف سرویس» است، نه بدون سقف. این پروژه خودکار شما را به plan پولی نمی‌برد و هیچ سرویس خارجی هم در صورت عبور از سقف استفاده نمی‌کند؛ در صورت رسیدن به سقف، سرویس‌های Cloudflare مطابق policy خودشان محدود می‌شوند تا reset روزانه.
