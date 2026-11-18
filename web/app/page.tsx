import {
  BellRing, CalendarClock, Camera, Check, Coins, Copy, Lock, MessageCircle, PieChart, PiggyBank,
  Plus, ShieldCheck, Smartphone, Sparkles,
} from 'lucide-react';
import { ChatDemo } from '@/components/ChatDemo';
import { LiveMascot } from '@/components/LiveMascot';
import { CountUp, Reveal } from '@/components/Motion';
import { TryIt } from '@/components/TryIt';
import { TintIcon } from '@/components/icons';

/** Add-friend link of the ShikSheek OA (@541ywsff). Opens the LINE app on phones, a QR page on desktop. */
const LINE_URL = process.env.NEXT_PUBLIC_LINE_ADD_URL || 'https://line.me/R/ti/p/%40541ywsff';

const PHRASES = ['กินข้าว 65', 'เติมน้ำมัน 500', 'ได้เงินเดือน 25000', 'ซื้อกาแฟ 80 เมื่อวาน', 'วันนี้ใช้ไปเท่าไหร่', 'ค่าเน็ต 599 ทุกวันที่ 5', 'พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง', 'เดือนนี้เหลือเงินเท่าไหร่'];

const FEATURES = [
  { icon: MessageCircle, tint: 'red', title: 'พิมพ์เหมือนคุยกับเพื่อน', body: '"กินข้าว 65" "ได้เงินเดือน 25000" ชิกชิกเข้าใจจำนวนเงิน หมวด และวันที่ แล้วให้คุณกดยืนยันก่อนเสมอ' },
  { icon: Camera, tint: 'yellow', title: 'ส่งสลิป ส่ง PDF ก็ได้', body: 'แค่ส่งรูปสลิปโอนเงินหรือ statement ชิกชิกอ่านยอดให้ และจำเลขรายการไว้ ส่งซ้ำก็ไม่จดซ้ำ' },
  { icon: CalendarClock, tint: 'blue', title: 'ไม่พลาดบิลประจำ', body: 'ค่าห้อง ค่าเน็ต ค่าผ่อน เตือนก่อนครบกำหนด กด "จ่ายแล้ว" ทีเดียว ไม่หักซ้ำแน่นอน' },
  { icon: PieChart, tint: 'green', title: 'งบที่เตือนทันเวลา', body: 'ตั้งงบรายหมวด แจ้งเตือนที่ 50% 80% และ 100% แค่ครั้งเดียวต่อรอบ ไม่รบกวน' },
  { icon: PiggyBank, tint: 'violet', title: 'เป้าหมายออมที่เห็นภาพ', body: 'ตั้งเป้าแล้วชิกชิกกันเงินออมไว้ให้ก่อนคำนวณยอดใช้ได้ พร้อมบอกว่าอีกกี่เดือนถึงเป้า' },
  { icon: BellRing, tint: 'brown', title: 'สรุปให้ ไม่ต้องขอ', body: 'สรุปวันละครั้งตอนสามทุ่ม สรุปสิ้นรอบเดือน เทียบกับช่วงก่อน ปิดเปิดเองได้ทั้งหมด' },
] as const;

const MOODS = [
  { mascot: 'proud', label: 'เงินเหลือเยอะ', quote: 'ภูมิใจในตัวเธอสุดๆ' },
  { mascot: 'happy', label: 'จดสำเร็จ', quote: 'จดให้แล้วจ้า!' },
  { mascot: 'celebrating', label: 'เงินเข้า', quote: 'ขอเต้นหน่อย~' },
  { mascot: 'worried', label: 'เหลือน้อย', quote: 'ค่อยๆ ใช้นะ' },
  { mascot: 'angry', label: 'เกินงบ', quote: 'ฮึ่ม! เกินแล้วนะ' },
  { mascot: 'shocked', label: 'ติดลบ', quote: 'ตกใจหมดเลย!' },
  { mascot: 'thinking', label: 'ขอถามก่อน', quote: 'อันนี้หมวดไหนน้า?' },
  { mascot: 'sleepy', label: 'พักบิล', quote: 'ไว้ค่อยว่ากัน zzz' },
] as const;

const TRUST = [
  { icon: Coins, title: 'นับเป็นสตางค์ ไม่ปัดเศษ', body: '฿45.50 × 30 แก้ว = ฿1,365 เป๊ะทุกครั้ง' },
  { icon: Check, title: 'ยืนยันก่อนบันทึกทุกครั้ง', body: 'ข้อความกำกวมจะถูกถามกลับ กดซ้ำก็บันทึกครั้งเดียว' },
  { icon: Copy, title: 'บิลและสลิปไม่ถูกนับซ้ำ', body: 'ฐานข้อมูลบังคับ 1 บิล 1 การจ่าย 1 สลิป 1 รายการ' },
  { icon: Sparkles, title: 'AI ไม่แตะตัวเลขของคุณ', body: 'AI ช่วยอ่านและเข้าใจ ส่วนตัวเลขมาจากระบบคำนวณที่ตรวจสอบได้' },
  { icon: Lock, title: 'ข้อมูลเป็นของคุณ', body: 'ส่งออก CSV/JSON หรือลบทั้งหมดได้ทุกเมื่อ ไม่เก็บรูปสลิป' },
  { icon: ShieldCheck, title: 'แยกข้อมูลรายคน', body: 'ทุกคำขอผูกกับบัญชี LINE ที่ยืนยันตัวตนแล้วเท่านั้น' },
] as const;

const FAQ = [
  { q: 'ต้องโหลดแอปเพิ่มไหม?', a: 'ไม่ต้องเลย ShikSheek อยู่ใน LINE เพิ่มเพื่อนแล้วพิมพ์ได้ทันที อยากดูละเอียดก็เปิดหน้าแอปจากในแชทได้' },
  { q: '"ใช้ได้อีก" คำนวณยังไง?', a: 'รายรับของรอบนี้ ลบรายจ่าย ลบเงินที่ออมแล้ว ลบบิลที่ยังไม่จ่าย และยอดที่ยังต้องกันไว้ออม แล้วหารด้วยวันที่เหลือเพื่อบอกว่าใช้ได้วันละเท่าไหร่' },
  { q: 'สลิปธนาคารไหนอ่านได้บ้าง?', a: 'อ่านได้ทั้งสลิปโอนเงินของธนาคารและ e-wallet ทั่วไป ใบเสร็จ และ statement แบบ PDF ที่ไม่ติดรหัสผ่าน ทุกครั้งจะขึ้นให้ตรวจยอดก่อนบันทึก' },
  { q: 'จดผิดแก้ได้ไหม?', a: 'ได้ ก่อนยืนยันเปลี่ยนหมวดหรือวันที่ได้ หลังบันทึกแก้หรือลบได้ในหน้าแอป และกดเอากลับได้ถ้าเปลี่ยนใจ' },
  { q: 'แจ้งเตือนเยอะไปไหม?', a: 'ปิดเปิดสรุปรายวัน รายสัปดาห์ รายเดือน เตือนบิล และเตือนงบ ได้แยกกันในหน้าตั้งค่า' },
] as const;

function Wordmark() {
  return (
    <span className="wordmark" aria-label="ShikSheek">
      <span className="wordmark__shik">Shik</span>
      <span className="wordmark__sheek">Sheek</span>
    </span>
  );
}

function LineButton({ children, variant = 'primary', size = 'md' }: { children: React.ReactNode; variant?: 'primary' | 'soft'; size?: 'sm' | 'md' }) {
  return (
    <a className={`cta cta--${variant} cta--${size}`} href={LINE_URL}>
      <MessageCircle size={size === 'sm' ? 16 : 18} strokeWidth={2.2} aria-hidden="true" />
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
            <img src="/mascot/happy.png" alt="" width={36} height={36} />
            <Wordmark />
          </a>
          <nav className="nav__links" aria-label="เมนูหลัก">
            <a href="#features">ฟีเจอร์</a>
            <a href="#how">วิธีใช้</a>
            <a href="#trust">ความแม่นยำ</a>
            <a href="#faq">คำถาม</a>
          </nav>
          <LineButton size="sm">เพิ่มเพื่อน</LineButton>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="wrap hero__grid">
            <div className="hero__copy">
              <p className="eyebrow"><Sparkles size={14} aria-hidden="true" /> ผู้ช่วยการเงินบน LINE</p>
              <h1>
                ให้เรื่องเงิน
                <br />
                เป็นเรื่อง<span className="swash">ชิกชิก</span>
              </h1>
              <p className="lead">พิมพ์ &ldquo;กินข้าว 65&rdquo; หรือส่งสลิปมา ชิกชิกจดให้ และบอกว่าเดือนนี้ <b>ใช้ได้อีกเท่าไหร่จริงๆ</b> หลังหักบิลและเงินออมแล้ว</p>
              <div className="hero__ctas">
                <LineButton>เพิ่มชิกชิกเป็นเพื่อน</LineButton>
                <a className="link-quiet" href="#how">ดูวิธีใช้</a>
              </div>
              <ul className="ticks">
                {['ฟรี', 'ไม่ต้องโหลดแอป', 'ยืนยันก่อนบันทึก'].map((t) => (
                  <li key={t}><Check size={14} strokeWidth={2.6} aria-hidden="true" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="hero__visual">
              <div className="blob" aria-hidden="true" />
              <ChatDemo />
              <div className="hero__live"><LiveMascot size={150} /></div>
            </div>
          </div>
        </section>

        <section className="phrases" aria-label="ตัวอย่างประโยคที่ชิกชิกเข้าใจ">
          <div className="phrases__track">
            {[...PHRASES, ...PHRASES].map((p, i) => (
              <span key={i} className="phrase" aria-hidden={i >= PHRASES.length}>{p}</span>
            ))}
          </div>
        </section>

        <section className="section section--tight" id="try">
          <div className="wrap split">
            <Reveal>
              <p className="kicker">ลองเลย ไม่ต้องสมัคร</p>
              <h2><span className="nb">พิมพ์แบบที่คุณพูด</span> <span className="nb">ชิกชิกเข้าใจ</span></h2>
              <p className="lead">จดทีละรายการหรือหลายรายการในข้อความเดียวก็ได้ อยากแก้บิลก็แค่บอกชื่อ เช่น &ldquo;ค่าห้อง เปลี่ยน 2000 3000&rdquo; ถ้าไม่แน่ใจ ชิกชิกจะถามก่อนเสมอ</p>
            </Reveal>
            <Reveal delay={120}><TryIt /></Reveal>
          </div>
        </section>

        <section className="section" id="available">
          <div className="wrap split">
            <div>
              <p className="kicker">ตัวเลขที่ตอบได้จริง</p>
              <h2>เดือนนี้เหลือเงินเท่าไหร่?</h2>
              <p className="lead">ยอดในบัญชีไม่ใช่เงินที่ใช้ได้ ชิกชิกหักบิลที่ยังไม่จ่ายและเงินที่ตั้งใจออมให้ก่อน แล้วบอกว่าใช้ได้วันละเท่าไหร่</p>
            </div>
            <div className="equation" role="img" aria-label="รายรับ 25,000 ลบใช้ไป 4,320 ลบบิลค้างจ่าย 7,099 ลบกันไว้ออม 1,101 เหลือใช้ได้ 12,480 บาท หรือวันละ 960 บาท">
              <div className="eq-row"><span>รายรับ</span><b className="pos"><CountUp to={25000} /></b></div>
              <div className="eq-row"><span>ใช้ไปแล้ว</span><b>− <CountUp to={4320} /></b></div>
              <div className="eq-row"><span>บิลค้างจ่าย</span><b>− <CountUp to={7099} /></b></div>
              <div className="eq-row"><span>กันไว้ออม</span><b>− <CountUp to={1101} /></b></div>
              <div className="eq-total">
                <div>
                  <small>ใช้ได้อีก</small>
                  <strong><CountUp to={12480} duration={1300} /></strong>
                  <em>วันละ ฿960 · เหลือ 13 วัน</em>
                </div>
                <img src="/mascot/proud.png" alt="" width={88} height={88} />
              </div>
            </div>
          </div>
        </section>

        <section className="section section--white" id="features">
          <div className="wrap">
            <Reveal className="section__head">
              <p className="kicker">ครบในแชทเดียว</p>
              <h2>จดง่าย ดูง่าย ไม่พลาดอะไร</h2>
            </Reveal>
            <div className="features">
              {FEATURES.map((f) => (
                <Reveal key={f.title} delay={FEATURES.indexOf(f) * 70}><article className="feature">
                  <TintIcon icon={f.icon} tint={f.tint} />
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--white" id="how">
          <div className="wrap">
            <Reveal className="section__head">
              <p className="kicker">เริ่มได้ในหนึ่งนาที</p>
              <h2>สามขั้นเท่านั้น</h2>
            </Reveal>
            <ol className="steps">
              <li><span className="steps__n">1</span><h3>เพิ่มเพื่อน</h3><p>เพิ่ม ShikSheek ใน LINE เลือกวันเริ่มรอบเดือน แล้วบอกรายรับ</p></li>
              <li><span className="steps__n">2</span><h3>พิมพ์หรือส่งสลิป</h3><p>&ldquo;ซื้อกาแฟ 80 เมื่อวาน&rdquo; หรือส่งรูปสลิป ไม่แน่ใจชิกชิกจะถามก่อน</p></li>
              <li><span className="steps__n">3</span><h3>กดยืนยัน</h3><p>เห็นทันทีว่าวันนี้ใช้ไปเท่าไหร่ และยังใช้ได้อีกเท่าไหร่ในรอบนี้</p></li>
            </ol>
            <div className="app-note">
              <TintIcon icon={Smartphone} tint="yellow" size={40} />
              <p><b>อยากดูละเอียด?</b> เปิดหน้าแอปจากในแชท ดูกราฟ แก้รายการ จัดการบิลและงบได้ในที่เดียว ล็อกอินด้วย LINE อัตโนมัติ</p>
            </div>
          </div>
        </section>

        <section className="section moods" aria-labelledby="moods-title">
          <div className="wrap">
            <Reveal className="section__head">
              <p className="kicker">น่ารักแต่จริงจัง</p>
              <h2 id="moods-title"><span className="nb">ชิกชิกรู้สึก</span><span className="nb">ไปกับเงินของคุณ</span></h2>
              <p className="lead">อารมณ์ของชิกชิกเปลี่ยนตามสถานะการเงินจริง เห็นปุ๊บรู้เลยว่าเดือนนี้เป็นยังไง</p>
            </Reveal>
            <ul className="moods__grid">
              {MOODS.map((m) => (
                <li key={m.mascot} className="mood" tabIndex={0}>
                  <span className="mood__quote" aria-hidden="true">{m.quote}</span>
                  <img src={`/mascot/${m.mascot}.png`} alt="" width={112} height={112} loading="lazy" />
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section section--white" id="trust">
          <div className="wrap">
            <Reveal className="section__head">
              <p className="kicker">น่ารักแต่ไม่มั่ว</p>
              <h2>เรื่องเงิน <span className="nb">ต้องแม่นก่อนน่ารัก</span></h2>
            </Reveal>
            <ul className="trust">
              {TRUST.map((t) => (
                <li key={t.title}>
                  <t.icon size={22} strokeWidth={2} className="trust__icon" aria-hidden="true" />
                  <div><h3>{t.title}</h3><p>{t.body}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="wrap faq">
            <div>
              <p className="kicker">คำถามที่พบบ่อย</p>
              <h2>สงสัยอะไร ถามได้</h2>
            </div>
            <div className="faq__list">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}<Plus size={18} strokeWidth={2.2} aria-hidden="true" /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="final" id="start">
          <div className="wrap">
            <div className="final__card">
              <LiveMascot size={190} />
              <div>
                <h2>พร้อมให้เรื่องเงิน<span className="nb">เป็นเรื่องชิกชิก</span>หรือยัง?</h2>
                <p>เพิ่มเพื่อนแล้วพิมพ์ &ldquo;กินข้าว 65&rdquo; ดูเลย <span className="nb">ชิกชิกรออยู่</span></p>
                <LineButton variant="soft">เพิ่มชิกชิกเป็นเพื่อนใน LINE</LineButton>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer__inner">
          <div className="nav__brand"><img src="/mascot/happy.png" alt="" width={28} height={28} /><Wordmark /></div>
          <p>ให้เรื่องเงินเป็นเรื่องชิกชิก · © {new Date().getFullYear()} ShikSheek · <a href="/terms">เงื่อนไขและการคืนเงิน</a></p>
        </div>
      </footer>
    </>
  );
}
