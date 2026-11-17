# แก้ปัญหา (Troubleshooting)

ดู log ก่อนเสมอ: Supabase Dashboard → **Edge Functions → (ชื่อ function) → Logs**
log เป็น JSON บรรทัดเดียว ไม่มีจำนวนเงินและ user id ถูกย่อ เช่น `U1234…abcd`

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|---|---|---|
| กด Verify ใน LINE Console แล้ว error | function ยังไม่ deploy / URL ผิด / `verify_jwt` ยังเปิด | `npx supabase functions deploy line-webhook` แล้วเช็คว่า `supabase/config.toml` มี `verify_jwt = false` |
| log ขึ้น `invalid_signature` | `LINE_CHANNEL_SECRET` ไม่ตรงกับ channel | ก๊อปจาก Basic settings ใหม่ → `supabase secrets set` → deploy ใหม่ |
| ตอบ 500 `misconfigured` | ขาด env ที่จำเป็น | log `bootstrap_failed` จะบอกชื่อตัวแปรที่ขาด |
| bot เงียบ ไม่มี log เลย | ปิด "Use webhook" / โปรเจกต์ Supabase ถูก pause | เปิด webhook, Restore project |
| bot ตอบซ้อนกับข้อความอัตโนมัติ | เปิด Auto-response / Greeting ใน OA Manager | ปิดตาม [line-setup.md](line-setup.md) ข้อ 4 |
| รูปมาสคอตไม่ขึ้นในการ์ด | `PUBLIC_ASSET_BASE_URL` ผิด / bucket ไม่ public | `node scripts/upload-assets.ts` แล้วเปิด URL รูปในเบราว์เซอร์ดูว่าเปิดได้ |
| ไม่มีสรุปรายวัน/เตือนบิล | cron ไม่ทำงาน / Vault secret ผิด / ปิดการแจ้งเตือน | SQL: `select * from cron.job_run_details order by start_time desc limit 5;` และ `select * from net._http_response order by created desc limit 5;` ดู status (401 = CRON_SECRET ไม่ตรงกับ Vault) |
| อยากส่งสรุปซ้ำเพื่อทดสอบ | ระบบกันส่งซ้ำด้วย `job_runs` | `delete from job_runs where job = 'daily_summary' and run_key = '2026-11-18';` แล้วเรียก scheduler ด้วย `force` |
| deploy แล้ว error หาไฟล์ `../../../src/...` ไม่เจอ | Supabase CLI รุ่นเก่า bundle เฉพาะโฟลเดอร์ functions | อัปเดต CLI: `npm i -D supabase@latest` แล้ว deploy ใหม่ |
| ยอด "ใช้ได้อีก" ดูแปลก | ส่วนใหญ่เป็นบิลที่ยังไม่จ่าย/เลยกำหนดถูกหักอยู่ | ดูแถว "บิลที่ยังไม่จ่าย" ในภาพรวม กด "จ่ายแล้ว" หรือ "ข้ามงวดนี้" |
| Rich Menu ไม่เปลี่ยน | LINE cache | ปิด-เปิดแชทใหม่ หรือรอ 1–2 นาที |
| AI ไม่ทำงาน | ไม่ได้ตั้ง `ANTHROPIC_API_KEY` / timeout | ระบบจะใช้ rule-based อัตโนมัติ ไม่กระทบการบันทึกเงิน |

## สูตรคำนวณ (ไว้เช็คตัวเลข)

```
ใช้ได้อีก = รายรับ − รายจ่าย − เงินที่ออมแล้ว − บิลที่ยังไม่จ่าย (ครบกำหนด ≤ สิ้นรอบ รวมที่เลยกำหนด) − ยอดที่ยังต้องกันไว้ออม
```

บิลที่จ่ายแล้วถูกนับครั้งเดียวในฐานะรายจ่าย (ฐานข้อมูลบังคับให้ 1 บิลจ่ายได้ 1 รายการ)

## รันเทสในเครื่อง

```bash
npm test          # unit + integration (Postgres จำลองด้วย PGlite ไม่ต้องมี Docker)
npm run typecheck
```
