import { ChatDemo } from '@/components/ChatDemo';

/** Set NEXT_PUBLIC_LINE_ADD_URL to your OA's add-friend link (LINE OA Manager → Gain friends). */
const LINE_URL = process.env.NEXT_PUBLIC_LINE_ADD_URL || '#start';

const PHRASES = ['กินข้าว 65', 'เติมน้ำมัน 500', 'ได้เงินเดือน 25000', 'ซื้อกาแฟ 80 เมื่อวาน', 'วันนี้ใช้ไปเท่าไหร่', 'พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง', 'ค่าเน็ต 599 ทุกวันที่ 5', 'เดือนนี้เหลือเงินเท่าไหร่'];

const FEATURES = [
  { mascot: 'happy', title: 'จดเหมือนแชทกับเพื่อน', body: 'พิมพ์ภาษาพูดได้เลย ชิกชิกแยกจำนวนเงิน หมวด และวันที่ให้ ("เมื่อวาน", "15 พ.ย.") แล้วให้คุณกดยืนยันก่อนบันทึกทุกครั้ง', tag: 'ภาษาไทยเต็มรูปแบบ' },
  { mascot: 'discipline', title: 'ไม่พลาดบิลอีกเลย', body: 'ค่าห้อง ค่าเน็ต ค่าผ่อน รายสัปดาห์ รายเดือน รายปี หรือทุก N วัน เตือนก่อนครบกำหนด กด "จ่ายแล้ว" ทีเดียวจบ', tag: 'เตือน 08:00 ทุกเช้า' },
  { mascot: 'smart', title: 'งบที่เตือนทันเวลา', body: 'ตั้งงบรายหมวดหรืองบรวม แจ้งเตือนเมื่อแตะ 50%, 80% และ 100% แค่ครั้งเดียวต่อรอบ ไม่สแปม', tag: 'แถบสีบอกสถานะ' },
  { mascot: 'saving', title: 'เป้าหมายออมที่เห็นภาพ', body: 'ตั้ง "เที่ยวญี่ปุ่น 30000 เดือนละ 3000" ชิกชิกกันเงินออมไว้ให้ก่อนคำนวณยอดใช้ได้ พร้อมบอกว่าอีกกี่เดือนถึงเป้า', tag: 'กันเงินอัตโนมัติ' },
  { mascot: 'planning', title: 'สรุปให้ ไม่ต้องขอ', body: 'สรุปวันนี้ตอน 3 ทุ่ม สรุปรายสัปดาห์ และสรุปสิ้นรอบเดือน เทียบกับช่วงก่อน พร้อมหมวดที่ใช้เยอะสุด', tag: 'ปิด/เปิดได้ทุกอย่าง' },
  { mascot: 'proud', title: 'รอบเดือนแบบคุณ', body: 'เงินเดือนออกวันที่ 25? ตั้งรอบเดือนให้เริ่มวันไหนก็ได้ (1–28) ทุกตัวเลขจะสรุปตามจังหวะชีวิตจริงของคุณ', tag: 'ยืดหยุ่น' },
] as const;

const MOODS = [
  { mascot: 'proud', label: 'เงินเหลือเยอะ', note: 'ภูมิใจในตัวเธอ' },
  { mascot: 'happy', label: 'จดสำเร็จ', note: 'จดให้แล้วจ้า' },
  { mascot: 'celebrating', label: 'เงินเข้า', note: 'ขอเต้นหน่อย!' },
  { mascot: 'worried', label: 'เหลือน้อย', note: 'ค่อยๆ ใช้นะ' },
  { mascot: 'angry', label: 'เกินงบ', note: 'โมโหนิดๆ นะ' },
  { mascot: 'shocked', label: 'ติดลบ', note: 'ตกใจหมดเลย' },
  { mascot: 'thinking', label: 'ไม่แน่ใจ', note: 'ขอถามก่อนนะ' },
  { mascot: 'sleepy', label: 'พักบิล', note: 'ไว้ค่อยว่ากัน' },
] as const;

const TRUST = [
  { title: 'คำนวณเป็นสตางค์ ไม่มีปัดเศษมั่ว', body: 'ทุกจำนวนเก็บเป็นจำนวนเต็มหน่วยสตางค์ ไม่ใช้ทศนิยมลอยตัว ฿45.50 × 30 แก้ว = ฿1,365 เป๊ะ' },
  { title: 'ไม่บันทึกจนกว่าคุณจะกดยืนยัน', body: 'ข้อความกำกวมจะถูกถามกลับ กดยืนยันซ้ำสองครั้งก็บันทึกครั้งเดียว' },
  { title: 'บิลที่จ่ายแล้ว ไม่ถูกหักซ้ำ', body: 'การจ่ายบิลกับการบันทึกรายจ่ายเกิดพร้อมกันในธุรกรรมเดียว และฐานข้อมูลบังคับให้ 1 บิลจ่ายได้ครั้งเดียว' },
  { title: 'AI ไม่แตะตัวเลขของคุณ', body: 'AI (ถ้าเปิดใช้) ช่วยแค่เข้าใจข้อความและหาคำพูดน่ารักๆ ตัวเลขทุกตัวมาจากระบบคำนวณที่มีเทสครอบคลุม' },
  { title: 'ข้อมูลเป็นของคุณ', body: 'ส่งออกเป็น CSV/JSON ด้วยลิงก์ใช้ครั้งเดียว หรือลบข้อมูลทั้งหมดถาวรได้จากเมนูตั้งค่า' },
  { title: 'แยกข้อมูลรายคนเด็ดขาด', body: 'ทุกคำสั่งผูกกับบัญชี LINE ของผู้ส่ง ตรวจลายเซ็นทุก webhook และปิดการเข้าถึงสาธารณะทุกตาราง' },
] as const;

const FAQ = [
  { q: 'ต้องโหลดแอปเพิ่มไหม?', a: 'ไม่ต้องเลย ShikSheek อยู่ใน LINE แค่เพิ่มเพื่อนแล้วเริ่มพิมพ์ได้ทันที' },
  { q: '"ใช้ได้อีก" คำนวณยังไง?', a: 'รายรับของรอบนี้ − รายจ่าย − เงินที่ออมแล้ว − บิลที่ยังไม่จ่าย (รวมที่เลยกำหนด) − ยอดที่ยังต้องกันไว้ออม แล้วหารด้วยจำนวนวันที่เหลือเพื่อบอกว่าใช้ได้วันละเท่าไหร่' },
  { q: 'พิมพ์ผิดหรือจดผิดแก้ได้ไหม?', a: 'ได้ ก่อนยืนยันเปลี่ยนหมวดหรือวันที่ได้ หลังบันทึกกด "ลบรายการนี้" และกด "เอากลับมา" ได้ถ้าเปลี่ยนใจ' },
  { q: 'จ่ายค่าไฟไม่เท่าที่ตั้งไว้ทำยังไง?', a: 'กด "จ่ายไม่เท่านี้" แล้วพิมพ์ยอดจริง ระบบจะใช้ยอดจริงในการคำนวณ' },
  { q: 'ข้อความแจ้งเตือนเยอะไปไหม?', a: 'ปิด/เปิดสรุปรายวัน รายสัปดาห์ รายเดือน เตือนบิล และเตือนงบ ได้แยกกันในเมนูตั้งค่า' },
] as const;

function Wordmark() {
  return (
    <span className="wordmark" aria-label="ShikSheek">
      <span className="wordmark__shik">Shik</span>
      <span className="wordmark__sheek">Sheek</span>
    </span>
  );
}

function LineButton({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'light' }) {
  return (
    <a className={`cta cta--${variant}`} href={LINE_URL}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3C6.48 3 2 6.6 2 11.03c0 3.97 3.55 7.3 8.35 7.93.33.07.77.22.88.5.1.25.07.65.03.9l-.14.86c-.04.25-.2.99.87.54 1.07-.45 5.77-3.4 7.87-5.82C21.32 14.36 22 12.77 22 11.03 22 6.6 17.52 3 12 3Zm-3.6 10.5H6.4a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 1 0v3.5h1.5a.5.5 0 0 1 0 1Zm1.9-.5a.5.5 0 0 1-1 0V9a.5.5 0 0 1 1 0v4Zm4.6 0a.5.5 0 0 1-.9.3l-2-2.75V13a.5.5 0 0 1-1 0V9a.5.5 0 0 1 .9-.3l2 2.75V9a.5.5 0 0 1 1 0v4Zm3.2-2.5a.5.5 0 0 1 0 1H16.6v1h1.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-1.5v1h1.5Z"/></svg>
      {children}
    </a>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip" href="#main">ข้ามไปเนื้อหา</a>
      <header className="nav">
        <div className="wrap nav__inner">
          <a href="#" className="nav__brand">
            <img src="/mascot/happy.png" alt="" width={40} height={40} />
            <Wordmark />
          </a>
          <nav className="nav__links" aria-label="เมนูหลัก">
            <a href="#features">ฟีเจอร์</a>
            <a href="#how">วิธีใช้</a>
            <a href="#trust">ความแม่นยำ</a>
            <a href="#faq">คำถาม</a>
          </nav>
          <LineButton>เพิ่มเพื่อน</LineButton>
        </div>
      </header>

      <main id="main">
        {/* HERO */}
        <section className="hero">
          <div className="wrap hero__grid">
            <div className="hero__copy">
              <p className="eyebrow">ผู้ช่วยการเงินบน LINE · ฟรี</p>
              <h1>
                ให้เรื่องเงิน
                <br />
                เป็นเรื่อง<span className="swash">ชิกชิก!</span>
              </h1>
              <p className="lead">
                แค่พิมพ์ <b>&ldquo;กินข้าว 65&rdquo;</b> ชิกชิกจดให้ คำนวณให้ว่าเดือนนี้<b>ใช้ได้อีกเท่าไหร่จริงๆ</b> หลังหักบิลที่ยังไม่จ่ายและเงินออม แล้วคอยเตือนก่อนบิลครบกำหนด
              </p>
              <div className="hero__ctas">
                <LineButton>เพิ่มชิกชิกเป็นเพื่อน</LineButton>
                <a className="link-arrow" href="#how">ดูวิธีใช้ →</a>
              </div>
              <ul className="hero__ticks">
                <li>ไม่ต้องโหลดแอป</li>
                <li>ภาษาไทยล้วน</li>
                <li>ยืนยันก่อนบันทึกทุกครั้ง</li>
              </ul>
            </div>
            <div className="hero__visual">
              <div className="blob" aria-hidden="true" />
              <img className="sticker sticker--a" src="/mascot/celebrating.png" alt="" width={120} height={120} />
              <img className="sticker sticker--b" src="/mascot/smart.png" alt="" width={130} height={130} />
              <ChatDemo />
            </div>
          </div>
        </section>

        {/* PHRASE MARQUEE */}
        <section className="marquee" aria-label="ตัวอย่างประโยคที่ชิกชิกเข้าใจ">
          <div className="marquee__track">
            {[...PHRASES, ...PHRASES].map((p, i) => (
              <span key={i} className="marquee__item" aria-hidden={i >= PHRASES.length}>
                &ldquo;{p}&rdquo;
              </span>
            ))}
          </div>
        </section>

        {/* AVAILABLE TO SPEND */}
        <section className="section available" id="available">
          <div className="wrap available__grid">
            <div>
              <p className="eyebrow eyebrow--red">ตัวเลขที่ตอบได้จริง</p>
              <h2>&ldquo;เดือนนี้เหลือเงินเท่าไหร่?&rdquo;</h2>
              <p className="lead">
                ยอดในบัญชีไม่ใช่เงินที่ใช้ได้ ชิกชิกหักบิลที่ยังไม่ได้จ่ายและเงินที่ตั้งใจออมออกให้ก่อน แล้วบอกว่าใช้ได้วันละเท่าไหร่จนถึงสิ้นรอบ
              </p>
              <p className="fineprint">บิลที่จ่ายแล้วถูกนับเป็นรายจ่ายครั้งเดียว ไม่หักซ้ำ</p>
            </div>
            <div className="equation" role="img" aria-label="ตัวอย่าง: รายรับ 25,000 ลบใช้ไปแล้ว 4,320 ลบบิลที่ยังไม่จ่าย 7,099 ลบกันไว้ออม 1,101 เท่ากับใช้ได้อีก 12,480 บาท หรือวันละ 960 บาท">
              <div className="eq-row"><span>รายรับ</span><b className="pos">฿25,000</b></div>
              <div className="eq-row"><span>ใช้ไปแล้ว</span><b>− ฿4,320</b></div>
              <div className="eq-row"><span>บิลที่ยังไม่จ่าย</span><b>− ฿7,099</b></div>
              <div className="eq-row"><span>กันไว้ออม</span><b>− ฿1,101</b></div>
              <div className="eq-total">
                <div>
                  <small>ใช้ได้อีก</small>
                  <strong>฿12,480</strong>
                  <em>≈ วันละ ฿960 · เหลือ 13 วัน</em>
                </div>
                <img src="/mascot/proud.png" alt="" width={96} height={96} />
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="section features" id="features">
          <div className="wrap">
            <div className="section__head">
              <p className="eyebrow eyebrow--red">ทุกอย่างที่ต้องใช้ ในแชทเดียว</p>
              <h2>เมนู 6 ปุ่ม <span className="nb">ครบทุกเรื่องเงิน</span></h2>
            </div>
            <div className="features__grid">
              {FEATURES.map((f) => (
                <article key={f.title} className="feature">
                  <img src={`/mascot/${f.mascot}.png`} alt="" width={96} height={96} loading="lazy" />
                  <span className="feature__tag">{f.tag}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
            <figure className="richmenu">
              <img src="/rich-menu.png" alt="เมนูหลักของ ShikSheek ใน LINE: ภาพรวม จดรายจ่าย จดรายรับ ค่าใช้จ่ายประจำ งบประมาณ รายงาน" width={1250} height={843} loading="lazy" />
              <figcaption>Rich Menu ใน LINE — กดปุ่มเดียวก็ถึงทุกฟีเจอร์</figcaption>
            </figure>
          </div>
        </section>

        {/* HOW */}
        <section className="section how" id="how">
          <div className="wrap">
            <div className="section__head">
              <p className="eyebrow eyebrow--red">เริ่มได้ใน 1 นาที</p>
              <h2>ง่ายแค่ 3 ขั้น</h2>
            </div>
            <ol className="steps">
              <li>
                <span className="steps__n">1</span>
                <h3>เพิ่มเพื่อน</h3>
                <p>เพิ่ม ShikSheek ใน LINE เลือกวันเริ่มรอบเดือน แล้วบอกรายรับเดือนนี้</p>
              </li>
              <li>
                <span className="steps__n">2</span>
                <h3>พิมพ์เหมือนคุยกับเพื่อน</h3>
                <p>&ldquo;ซื้อกาแฟ 80 เมื่อวาน&rdquo; ชิกชิกเข้าใจจำนวนเงิน หมวด และวันที่ ถ้าไม่แน่ใจจะถามก่อน</p>
              </li>
              <li>
                <span className="steps__n">3</span>
                <h3>กดยืนยัน รู้ผลทันที</h3>
                <p>บันทึกแล้วเห็นเลยว่าวันนี้ใช้ไปเท่าไหร่ และยังใช้ได้อีกเท่าไหร่ในรอบนี้</p>
              </li>
            </ol>
          </div>
        </section>

        {/* MOODS */}
        <section className="section moods" aria-labelledby="moods-title">
          <div className="wrap">
            <div className="section__head">
              <p className="eyebrow">ไม่ใช่แค่แอปจดเงิน</p>
              <h2 id="moods-title"><span className="nb">ชิกชิกรู้สึก</span><span className="nb">ไปกับเงินของคุณ</span></h2>
              <p className="lead lead--light">อารมณ์ของชิกชิกเปลี่ยนตามสถานะการเงินจริง เห็นปุ๊บรู้ปั๊บว่าเดือนนี้เป็นยังไง</p>
            </div>
            <ul className="moods__grid">
              {MOODS.map((m) => (
                <li key={m.mascot} className="mood">
                  <img src={`/mascot/${m.mascot}.png`} alt="" width={120} height={120} loading="lazy" />
                  <b>{m.label}</b>
                  <span>&ldquo;{m.note}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* TRUST */}
        <section className="section trust" id="trust">
          <div className="wrap">
            <div className="section__head">
              <p className="eyebrow eyebrow--red">น่ารักแต่ไม่มั่ว</p>
              <h2>เรื่องเงิน <span className="nb">ต้องแม่นก่อนน่ารัก</span></h2>
            </div>
            <div className="trust__grid">
              {TRUST.map((t, i) => (
                <div key={t.title} className="trust__item">
                  <span className="trust__n">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section faq" id="faq">
          <div className="wrap faq__grid">
            <div>
              <p className="eyebrow eyebrow--red">คำถามที่พบบ่อย</p>
              <h2>สงสัยอะไร ถามได้</h2>
              <img src="/mascot/thinking.png" alt="" width={160} height={160} loading="lazy" className="faq__mascot" />
            </div>
            <div className="faq__list">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="final" id="start">
          <div className="wrap final__inner">
            <div className="final__art"><img src="/mascot/encouraging.png" alt="" width={220} height={220} loading="lazy" /></div>
            <div>
              <h2>พร้อมให้เรื่องเงิน<span className="nb">เป็นเรื่องชิกชิก</span>หรือยัง?</h2>
              <p>เพิ่มเพื่อนแล้วพิมพ์ &ldquo;กินข้าว 65&rdquo; ดูเลย <span className="nb">ชิกชิกรออยู่</span></p>
              <LineButton variant="light">เพิ่มชิกชิกเป็นเพื่อนใน LINE</LineButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer__inner">
          <div className="nav__brand">
            <img src="/mascot/happy.png" alt="" width={32} height={32} />
            <Wordmark />
          </div>
          <p>ให้เรื่องเงินเป็นเรื่องชิกชิก! · © {new Date().getFullYear()} ShikSheek</p>
        </div>
      </footer>
    </>
  );
}
