# มาสคอต ชิกชิก 🐔

**สเปกตัวละคร (ห้ามเปลี่ยน):** ไก่สีขาว หงอนแดง ปากเหลือง แก้มชมพู เส้นขอบน้ำตาลเข้ม ตัวเดียวกันทุกข้อความ

ภาพทั้งหมดตัดมาจาก `assets/branding/sticker-sheet.png` ด้วย `node scripts/build-mascots.ts` (ลบพื้นหลังครีมให้โปร่งใส 512×512)
โค้ดเรียกรูปผ่าน `src/presentation/line/mascot.ts` เท่านั้น (`mascotUrl('happy')`) ไม่มีการสร้างรูปใหม่ต่อข้อความ

| ชื่อ (ในโค้ด) | ไฟล์ | ใช้เมื่อ |
|---|---|---|
| `happy` | mascot/happy.png | บันทึกสำเร็จ ทักทาย |
| `proud` | mascot/proud.png | เงินเหลือเยอะ (≥ 50% ของรายรับ) วันที่ไม่ใช้เงิน |
| `angry` | mascot/angry.png | เกินงบ 100% |
| `worried` | mascot/worried.png | เหลือน้อย (< 10%) เตือนงบ 80% error |
| `shocked` | mascot/shocked.png | ติดลบ รายจ่ายก้อนใหญ่ (≥ ฿5,000) |
| `thinking` | mascot/thinking.png | การ์ดยืนยัน ไม่เข้าใจข้อความ ยังไม่มีรายรับ |
| `sleepy` | mascot/sleepy.png | หยุดบิลชั่วคราว |
| `celebrating` | mascot/celebrating.png | ได้รายรับ ถึงเป้าออม ตั้งค่าเสร็จ |
| `encouraging` | mascot/encouraging.png | ต้อนรับ เริ่มต้น เริ่มบิลใหม่ |
| `excited` | mascot/excited.png | (สำรอง) |
| `saving` | mascot/saving.png | เป้าหมายออม รายรับใน Rich Menu |
| `planning` | mascot/planning.png | ตั้งค่า รายงาน ประวัติ |
| `smart` | mascot/smart.png | วิธีใช้ จ่ายบิล ตั้งค่า |
| `discipline` | mascot/discipline.png | ค่าใช้จ่ายประจำ เตือนบิล |

## เปลี่ยนเป็นภาพวาดใหม่

1. วาด PNG โปร่งใส 512×512 ตามชื่อไฟล์ด้านบน (ชื่อต้องตรงเป๊ะ)
2. วางทับใน `assets/mascot/`
3. เพิ่ม `MASCOT_ASSET_VERSION` ใน `mascot.ts` (ให้ LINE โหลดรูปใหม่)
4. `node scripts/upload-assets.ts` และ `node scripts/build-rich-menu.ts && node scripts/setup-rich-menu.ts`

ไม่ต้องแก้ template ใดๆ

## ฟอนต์

Rich Menu ใช้ฟอนต์ **Prompt** (Google Fonts, SIL Open Font License, ไฟล์อยู่ที่ `assets/fonts/`)
