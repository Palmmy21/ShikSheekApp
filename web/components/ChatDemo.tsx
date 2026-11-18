/**
 * Faithful, simplified replica of the real LINE flow: user types → confirmation card → saved.
 * CSS-only animation; respects reduced motion.
 */
export function ChatDemo() {
  return (
    <div className="phone" aria-label="ตัวอย่างการคุยกับชิกชิกใน LINE">
      <div className="phone__bar">
        <img src="/mascot/happy.png" alt="" width={26} height={26} />
        <span>ShikSheek</span>
      </div>
      <div className="phone__chat">
        <div className="bubble bubble--me d1">กินข้าวมันไก่ 65</div>
        <div className="fcard d2" role="group" aria-label="การ์ดยืนยันรายการ">
          <div className="fcard__head">
            <span>จดแบบนี้ใช่ไหม?</span>
            <img src="/mascot/thinking.png" alt="" width={40} height={40} />
          </div>
          <div className="fcard__amount">฿65</div>
          <div className="kv"><span>หมวด</span><b>อาหาร</b></div>
          <div className="kv"><span>วันที่</span><span>วันนี้</span></div>
          <div className="fbtn">ยืนยัน ฿65</div>
        </div>
        <div className="bubble bubble--me bubble--tap d3">ยืนยัน</div>
        <div className="fcard d4" role="group" aria-label="การ์ดบันทึกสำเร็จ">
          <div className="fcard__head">
            <span>บันทึกแล้ว</span>
            <img src="/mascot/happy.png" alt="" width={40} height={40} />
          </div>
          <p className="fcard__say">จดให้แล้วจ้า ชิกชิกจำไว้ให้หมดเลย</p>
          <div className="kv"><span>ใช้ได้อีก</span><b>฿12,480</b></div>
          <div className="kv"><span>เฉลี่ยวันละ</span><span>฿960</span></div>
        </div>
      </div>
    </div>
  );
}
