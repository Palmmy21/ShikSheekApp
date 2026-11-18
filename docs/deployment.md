# คู่มือ Deploy ShikSheek (Supabase + LINE)

ใช้เวลาประมาณ 30–45 นาที ทำตามลำดับนี้ได้เลย

## 0. สิ่งที่ต้องมี

- บัญชี [Supabase](https://supabase.com) (ฟรีก็ได้ แต่อ่านหมายเหตุเรื่อง pause ในข้อ 8)
- บัญชี [LINE Developers](https://developers.line.biz) + LINE Official Account (ดู [line-setup.md](line-setup.md))
- Node.js 20+ ในเครื่อง (`node -v`)
- (ไม่บังคับ) Anthropic API key ถ้าอยากเปิดใช้ AI

```bash
git clone https://github.com/Palmmy21/ShikSheekApp.git
cd ShikSheekApp
npm install
npm test            # ต้องผ่านทั้งหมดก่อน deploy
cp .env.example .env
```

## 1. สร้างโปรเจกต์ Supabase

1. Supabase Dashboard → **New project** → region แนะนำ **Southeast Asia (Singapore)**
2. จด **Project ref** (ส่วน `xxxx` ใน `https://xxxx.supabase.co`) และ **Database password**
3. ใส่ใน `.env`:
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<Project Settings → API → service_role>   # ใช้เฉพาะสคริปต์อัปโหลดรูป ห้าม deploy
   ```

## 2. ลง schema ฐานข้อมูล

```bash
npx supabase login
npx supabase link --project-ref <ref>
```

**ก่อน push migration** ต้องสร้าง secret ใน Vault สำหรับ cron (SQL Editor ใน Dashboard):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/scheduler', 'shiksheek_scheduler_url');
select vault.create_secret('<สุ่มสตริงยาว 32+ ตัว เก็บไว้ใช้ในข้อ 4 ด้วย>', 'shiksheek_cron_secret');
```

สุ่ม secret ได้ด้วย: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

จากนั้น:

```bash
npx supabase db push
```

จะได้ตารางทั้งหมด + RLS + pg_cron job `shiksheek-hourly` (เช็คได้ที่ Database → Cron)

## 3. อัปโหลดรูปมาสคอต

```bash
node scripts/upload-assets.ts
```

สคริปต์จะสร้าง bucket สาธารณะ `assets` และพิมพ์ค่า `PUBLIC_ASSET_BASE_URL` ออกมา ใส่ไว้ใน `.env`

## 4. ตั้งค่า secrets ให้ Edge Functions

สร้างไฟล์ `.env.production` (ห้าม commit):

```
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
PUBLIC_ASSET_BASE_URL=https://<ref>.supabase.co/storage/v1/object/public/assets
CRON_SECRET=<ค่าเดียวกับ shiksheek_cron_secret ใน Vault>
# ไม่บังคับ
ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-5-5
AI_PERSONALITY=false
```

```bash
npx supabase secrets set --env-file .env.production
```

`SUPABASE_URL` และ `SUPABASE_DB_URL` Supabase ใส่ให้อัตโนมัติ ไม่ต้องตั้งเอง

## 5. Deploy functions

```bash
npx supabase functions deploy line-webhook
npx supabase functions deploy scheduler
npx supabase functions deploy data-export
```

`supabase/config.toml` ปิด `verify_jwt` ให้ทั้ง 3 ตัวแล้ว (แต่ละตัวยืนยันตัวตนเอง: ลายเซ็น LINE / CRON_SECRET / token ใช้ครั้งเดียว)

## 6. ต่อ LINE webhook

LINE Developers Console → channel → **Messaging API**:
- Webhook URL: `https://<ref>.supabase.co/functions/v1/line-webhook`
- กด **Verify** → ต้องขึ้น Success
- เปิด **Use webhook**

## 7. Rich Menu + ตรวจ Flex

```bash
node scripts/setup-rich-menu.ts   # สร้างเมนู อัปโหลดรูป ตั้งเป็นค่าเริ่มต้น
node scripts/validate-flex.ts     # ส่งทุก template ให้ LINE ตรวจ (ไม่ได้ส่งข้อความจริง)
```

## 8. ทดสอบ

1. Add เพื่อน LINE OA → ต้องได้ข้อความต้อนรับ
2. พิมพ์ `กินข้าว 65` → การ์ดยืนยัน → กดยืนยัน → บันทึก
3. ทดสอบ scheduler ด้วยมือ:
   ```bash
   curl -X POST "https://<ref>.supabase.co/functions/v1/scheduler" \
     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
     -d '{"force":["daily_summary"]}'
   ```
4. ดู log: Dashboard → Edge Functions → line-webhook → Logs

### หมายเหตุสำคัญ

- **แพ็กเกจฟรีของ Supabase** อาจ pause โปรเจกต์ที่ไม่มีการใช้งานราว 7 วัน ถ้าใช้ทุกวันมักไม่โดน แต่ถ้าโดน bot จะเงียบ ให้กด Restore ใน Dashboard หรือใช้แพ็กเกจ Pro
- **โควตา push ของ LINE OA**: การตอบกลับ (reply) ฟรี แต่สรุปรายวัน/เตือนบิลเป็น push ใช้คนเดียวประมาณ 35–45 ข้อความ/เดือน ปิดสรุปรายวันได้ในเมนูตั้งค่า
- **Import นอกโฟลเดอร์ functions**: functions import โค้ดจาก `src/` (ผ่าน `deno check` แล้ว) ถ้า CLI รุ่นที่ใช้ bundle ไม่เจอไฟล์ ให้อัปเดต CLI (`npm i -D supabase@latest`) หรือดู [troubleshooting.md](troubleshooting.md)

## อัปเดตเวอร์ชัน

```bash
git pull && npm install && npm test
npx supabase db push                      # ถ้ามี migration ใหม่
npx supabase functions deploy line-webhook && npx supabase functions deploy scheduler && npx supabase functions deploy data-export
```

## Payments: going live (Stripe PromptPay)

Test mode is live already (checkout visible only to `PAYMENT_TEST_USERS`). To take real money:

1. **Activate the Stripe account** (Dashboard → Activate payments: business details, ID, Thai bank account).
2. Fill the placeholders in `web/app/terms/page.tsx` (business name, address, contact) and have it reviewed.
3. Put `STRIPE_LIVE_SECRET_KEY=sk_live_…` in `.env.production`, then:
   ```bash
   node --env-file=.env.production scripts/stripe-go-live.ts   # PromptPay-only config + live webhook → .env.stripe-live
   npx supabase secrets set --env-file .env.stripe-live          # switches the bot to live keys
   npx supabase functions deploy line-webhook api payment-webhook scheduler
   ```
   With an `sk_live_` key the buy buttons appear for everyone (`PAYMENT_TEST_USERS` is ignored).
4. Smoke test with real money: buy Plus monthly (฿49) yourself, confirm the "ได้รับเงินแล้ว" message,
   then refund it in the Dashboard (PromptPay refunds cost ฿10; Stripe emails the payer for bank details).

**Refunds / corrections.** Refunding in Stripe does not change the plan automatically. Shorten or
end access with SQL, e.g. `select grant_plan('<LINE user id>', 'plus', -30, 'manual');`
(a negative number of days pulls the end date back; the user falls back to Free when it passes).

**Rollback.** `npx supabase secrets set --env-file <file with the sk_test_ values>` and redeploy.
