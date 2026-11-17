# ตั้งค่า LINE Developers Console

## 1. สร้าง LINE Official Account + Messaging API channel

1. เข้า [LINE Official Account Manager](https://manager.line.biz) → **Create** account (ตั้งชื่อ เช่น "ShikSheek ชิกชิก")
2. ในหน้า account → **Settings → Messaging API → Enable Messaging API** → เลือก/สร้าง Provider
3. เข้า [LINE Developers Console](https://developers.line.biz/console/) → Provider → channel ที่เพิ่งสร้าง

## 2. เก็บ credentials (ใส่ใน `.env` / `.env.production`)

| ค่า | อยู่ที่ |
|---|---|
| `LINE_CHANNEL_SECRET` | แท็บ **Basic settings → Channel secret** |
| `LINE_CHANNEL_ACCESS_TOKEN` | แท็บ **Messaging API → Channel access token (long-lived) → Issue** |

ห้าม commit สองค่านี้ ถ้าหลุด ให้กด Reissue ทันที แล้ว `supabase secrets set` ใหม่

## 3. แท็บ Messaging API

| ตั้งค่า | ค่า |
|---|---|
| Webhook URL | `https://<project-ref>.supabase.co/functions/v1/line-webhook` |
| Use webhook | **เปิด** |
| Webhook redelivery | ปิดไว้ก็ได้ (ระบบกันซ้ำด้วย `webhookEventId` อยู่แล้ว) |
| Allow bot to join group chats | **ปิด** (bot ทำงานเฉพาะแชท 1:1) |

## 4. ใน LINE Official Account Manager → Response settings

| ตั้งค่า | ค่า |
|---|---|
| Chat (แชทโดยแอดมิน) | **ปิด** |
| Greeting message | **ปิด** (bot ส่งข้อความต้อนรับเองตอน follow) |
| Auto-response | **ปิด** (ไม่งั้นจะตอบซ้อนกับ bot) |
| Webhooks | **เปิด** |

## 5. Rich Menu

ใช้สคริปต์ `node scripts/setup-rich-menu.ts` (อย่าสร้างใน OA Manager เพราะเมนูจาก OA Manager ส่ง postback ไม่ได้)
ปุ่มทั้ง 6 ส่ง postback ไปที่ backend:

| ปุ่ม | postback | การทำงาน |
|---|---|---|
| ภาพรวม | `a=dashboard` | การ์ดยอดใช้ได้จริง บิลใกล้ถึง งบ |
| จดรายจ่าย | `a=add_expense` | เลือกหมวด/พิมพ์รายการ (เปิดคีย์บอร์ดให้) |
| จดรายรับ | `a=add_income` | เหมือนกันสำหรับรายรับ |
| ค่าใช้จ่ายประจำ | `a=fixed_costs` | รายการบิลประจำ เพิ่ม/จ่าย/หยุด/ลบ |
| งบประมาณ | `a=budgets` | ความคืบหน้างบรายหมวด |
| รายงาน | `a=reports` | สรุปวัน/สัปดาห์/เดือน ประวัติ เป้าหมายออม |

## 6. ข้อจำกัดที่ควรรู้

- Reply token ใช้ได้ครั้งเดียวและหมดอายุเร็ว ระบบตอบทันทีหลังประมวลผล
- Push message นับโควตาตามแพ็กเกจของ OA (แพ็กเกจฟรีมีจำนวนจำกัดต่อเดือน)
- รูปใน Flex ต้องเป็น HTTPS สาธารณะ (ใช้ Supabase Storage bucket `assets`)
