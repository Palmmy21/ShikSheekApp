/**
 * A faithful HTML replica of the real LINE flow (same copy and layout as the bot's Flex templates):
 * user types → confirmation card → saved card. Animated with CSS only.
 */
export function ChatDemo() {
  return (
    <div className="phone" aria-label="ตัวอย่างการคุยกับชิกชิกใน LINE">
      <div className="phone__bar">
        <img src="/mascot/happy.png" alt="" width={28} height={28} />
        <span>ShikSheek ชิกชิก</span>
      </div>
      <div className="phone__chat">
        <div className="bubble bubble--me d1">กินข้าวมันไก่ 65</div>

        <div className="flex-card d2" role="group" aria-label="การ์ดยืนยันรายการ">
          <div className="flex-card__head">
            <div>
              <small>ยืนยันรายการ</small>
              <strong>จดแบบนี้ใช่ไหม?</strong>
            </div>
            <img src="/mascot/thinking.png" alt="" width={52} height={52} />
          </div>
          <div className="flex-card__body">
            <div className="flex-card__inner">
              <small>รายจ่าย</small>
              <div className="amount">฿65</div>
              <hr />
              <div className="kv"><span>หมวด</span><b>🍜 อาหาร</b></div>
              <div className="kv"><span>วันที่</span><span>วันนี้</span></div>
            </div>
            <div className="btn btn--primary">✅ ยืนยัน ฿65</div>
          </div>
        </div>

        <div className="bubble bubble--me bubble--tap d3">ยืนยัน</div>

        <div className="flex-card d4" role="group" aria-label="การ์ดบันทึกสำเร็จ">
          <div className="flex-card__head">
            <div>
              <small>บันทึกแล้ว ✓</small>
              <strong>🍜 ฿65</strong>
            </div>
            <img src="/mascot/happy.png" alt="" width={52} height={52} />
          </div>
          <div className="flex-card__body">
            <p className="say">จดให้แล้วจ้า ชิกชิกจำไว้ให้หมดเลย 🐔</p>
            <div className="flex-card__inner">
              <div className="kv"><span>ใช้ได้อีก (รอบนี้)</span><b>฿12,480</b></div>
              <div className="kv"><span>เฉลี่ยใช้ได้วันละ</span><span>฿960</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
