/** Sample data for the LIFF design preview (`/liff/?demo=1`). Nothing here touches real data. */
const m = (satang: number) => ({ satang, text: `฿${(satang / 100).toLocaleString('en-US', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 })}` });
const cat = (id: string, label: string) => ({ id, label, emoji: '' });
const today = '2026-11-18';

const categories = [
  ['food', 'expense', 'อาหาร'], ['transport', 'expense', 'เดินทาง'], ['shopping', 'expense', 'ช้อปปิ้ง'], ['bills', 'expense', 'บิล/ค่าบริการ'],
  ['health', 'expense', 'สุขภาพ'], ['entertainment', 'expense', 'บันเทิง'], ['home', 'expense', 'บ้าน/ของใช้'], ['education', 'expense', 'การศึกษา'],
  ['family', 'expense', 'ครอบครัว/ให้'], ['pet', 'expense', 'สัตว์เลี้ยง'], ['other_expense', 'expense', 'อื่นๆ'],
  ['salary', 'income', 'เงินเดือน'], ['bonus', 'income', 'โบนัส'], ['freelance', 'income', 'งานเสริม'], ['gift_income', 'income', 'ได้รับเงิน'],
  ['investment', 'income', 'ลงทุน/ดอกเบี้ย'], ['refund', 'income', 'เงินคืน'], ['other_income', 'income', 'รายรับอื่นๆ'], ['savings', 'saving', 'เงินออม'],
].map(([id, kind, label]) => ({ id, kind, label, emoji: '' }));

const daily = Array.from({ length: 30 }, (_, i) => {
  const d = `2026-11-${String(i + 1).padStart(2, '0')}`;
  const v = d > today ? 0 : [12000, 8500, 0, 23000, 6500, 4500, 31000, 9000, 15000, 0, 7200, 18800, 5600, 42000, 6500, 11000, 8000, 186400][i] ?? 0;
  return { date: d, expense: m(v) };
});

const txns = [
  { id: 't1', type: 'expense', amount: m(6500), category: cat('food', 'อาหาร'), note: 'ข้าวมันไก่', date: today, source: 'chat', isBillPayment: false },
  { id: 't2', type: 'expense', amount: m(125000), category: cat('food', 'อาหาร'), note: 'ร้านกาแฟดอยช้าง', date: today, source: 'slip', isBillPayment: false },
  { id: 't3', type: 'expense', amount: m(50000), category: cat('transport', 'เดินทาง'), note: 'เติมน้ำมัน', date: '2026-11-17', source: 'chat', isBillPayment: false },
  { id: 't4', type: 'expense', amount: m(59900), category: cat('bills', 'บิล/ค่าบริการ'), note: 'ค่าเน็ต', date: '2026-11-05', source: 'fixed_cost', isBillPayment: true },
  { id: 't5', type: 'income', amount: m(2500000), category: cat('salary', 'เงินเดือน'), note: 'เงินเดือน', date: '2026-11-01', source: 'chat', isBillPayment: false },
];

const budgets = [
  { id: 'b1', category: cat('food', 'อาหาร'), limit: m(600000), spent: m(486000), remaining: m(114000), percent: 81, level: 'warning' },
  { id: 'b2', category: cat('transport', 'เดินทาง'), limit: m(300000), spent: m(95000), remaining: m(205000), percent: 31, level: 'ok' },
];

const ROUTES: Record<string, unknown> = {
  '/referral': { code: 'AB3XYZ', invited: 3, rewarded: 2, remaining: 10, link: 'https://liff.line.me/demo?ref=AB3XYZ', shareText: 'มาจดเงินกับชิกชิก', rewardDays: 30, activationEntries: 3, streak: 6 },
  '/plan': {
    plan: 'pro', label: 'Pro', source: 'trial', until: '2026-12-02T00:00:00Z', daysLeft: 9,
    limits: { fixedCosts: null, goals: null, categoryBudgets: true, docsPerMonth: 500, aiPerMonth: null, scheduledPush: true },
    usage: { docs: 6, ai: 23, fixedCosts: 4, goals: 2 },
    prices: { plus: { monthly: 49, yearly: 399, earlyBirdYearly: 299 }, pro: { monthly: 129, yearly: 1090 } },
    pitch: {
      plus: ['บิลประจำไม่จำกัด + เตือนก่อนครบกำหนด', 'สรุปรายวัน/รายสัปดาห์ส่งถึงแชท', 'งบทุกหมวด · เป้าออม 5 เป้า', 'อ่านสลิป/PDF 150 ครั้ง/เดือน', 'AI เข้าใจประโยคกำกวมไม่จำกัด'],
      pro: ['ทุกอย่างใน Plus', 'เป้าออมไม่จำกัด', 'อ่านสลิป/PDF 500 ครั้ง/เดือน', 'ได้ใช้ฟีเจอร์ใหม่ก่อนใคร: บัตรเครดิตหลายใบ ผู้ช่วยลดหย่อนภาษี กระเป๋าครอบครัว'],
    },
  },
  '/me': { plan: { id: 'pro', label: 'Pro', source: 'trial', daysLeft: 9 }, displayName: 'ปาล์ม', cycleStartDay: 1, autoRecord: false, notifications: { dailySummary: true, weeklySummary: false, monthlySummary: true, billReminders: true, budgetAlerts: true, streakReminders: true }, today },
  '/categories': categories,
  '/story': {
    periodLabel: 'พ.ย. 2569',
    persona: { id: 'golden', title: 'ไก่ทองคำ', tagline: 'เก็บได้เกินครึ่งของรายรับ ระดับตำนาน', mascot: 'celebrating', theme: 'gold' },
    planBadge: 'PRO',
    invite: { code: 'AB3XYZ', line: 'ทักไลน์ @541ywsff ใส่โค้ด AB3XYZ รับ Plus ฟรี 30 วัน' },
    period: { start: '2026-11-01', end: '2026-11-30' },
    cards: [
      {
        kind: 'recap', theme: 'gold', mascot: 'celebrating', eyebrow: 'เดือนนี้ของ ปาล์ม · พ.ย. 2569', title: 'ไก่ทองคำ', subtitle: 'เก็บได้เกินครึ่งของรายรับ ระดับตำนาน',
        hero: { label: 'เก็บได้แล้ว', value: '฿20,680', private: true },
        stats: [{ label: 'อัตราเก็บเงิน', value: '82%', private: false }, { label: 'จดไป', value: '47 รายการ', private: false }, { label: 'หมวดโปรด', value: 'อาหาร 43%', private: false }],
        badge: 'ออมเก่งกว่า 87% ของผู้ใช้ชิกชิก',
      },
      {
        kind: 'streak', theme: 'night', mascot: 'discipline', eyebrow: 'ปาล์ม จดเงินกับชิกชิก', title: 'ไฟลุกสองสัปดาห์ 🔥', subtitle: 'คนส่วนใหญ่เลิกจดไปตั้งแต่วันที่ 3',
        hero: { label: 'จดติดกัน', value: '16 วัน', private: false }, stats: [{ label: 'เดือนนี้จดไป', value: '47 รายการ', private: false }], badge: null,
      },
      {
        kind: 'goal', theme: 'green', mascot: 'planning', eyebrow: 'เป้าหมายเงินเก็บ', title: 'ไปแล้ว 30%', subtitle: 'ทีละนิด ใกล้เข้าไปทุกวัน',
        hero: { label: 'เป้าหมาย', value: 'เที่ยวญี่ปุ่น', private: true },
        stats: [{ label: 'เก็บแล้ว', value: '฿9,000', private: true }, { label: 'ความคืบหน้า', value: '30%', private: false }], badge: null,
      },
    ],
  },
  '/dashboard': {
    period: { key: '2026-11', start: '2026-11-01', end: '2026-11-30' },
    available: m(1248000), dailyAllowance: m(96000), daysRemaining: 13, isNegative: false, hasIncome: true,
    income: m(2500000), expense: m(432000), unpaidBills: m(709900), unpaidBillCount: 2, savings: m(110100), today: m(186400),
    topCategories: [{ ...cat('food', 'อาหาร'), amount: m(186000) }, { ...cat('transport', 'เดินทาง'), amount: m(95000) }, { ...cat('bills', 'บิล/ค่าบริการ'), amount: m(59900) }, { ...cat('shopping', 'ช้อปปิ้ง'), amount: m(45000) }],
    upcomingBills: [{ occurrenceId: 'o1', name: 'ค่าห้อง', dueDate: '2026-11-25', status: 'upcoming', amount: m(650000) }, { occurrenceId: 'o2', name: 'Netflix', dueDate: '2026-11-19', status: 'upcoming', amount: m(41900) }],
    budgets,
  },
  '/reports/month': { period: { key: '2026-11', start: '2026-11-01', end: '2026-11-30', previousKey: '2026-10' }, income: m(2500000), expense: m(432000), saving: m(110100), net: m(1957900), expenseChange: m(-34500), categories: [], daily, budgets },
  '/fixed-costs': [
    { id: 'f1', name: 'ค่าห้อง', amount: m(650000), category: cat('home', 'บ้าน/ของใช้'), schedule: 'ทุกเดือน วันที่ 25', status: 'active', remindDaysBefore: 1, next: { occurrenceId: 'o1', dueDate: '2026-11-25', status: 'upcoming', amount: m(650000) }, overdue: [] },
    { id: 'f2', name: 'Netflix', amount: m(41900), category: cat('entertainment', 'บันเทิง'), schedule: 'ทุกเดือน วันที่ 19', status: 'active', remindDaysBefore: 1, next: { occurrenceId: 'o2', dueDate: '2026-11-19', status: 'upcoming', amount: m(41900) }, overdue: [] },
    { id: 'f3', name: 'ยิม', amount: m(30000), category: cat('health', 'สุขภาพ'), schedule: 'ทุกสัปดาห์ วันจันทร์', status: 'paused', remindDaysBefore: 1, next: null, overdue: [] },
  ],
  '/budgets': { period: { start: '2026-11-01', end: '2026-11-30' }, items: budgets },
  '/goals': [
    { id: 'g1', name: 'เที่ยวญี่ปุ่น', target: m(3000000), saved: m(900000), monthlyReserve: m(300000), progressPercent: 30, isReached: false, periodsToGoal: 7 },
    { id: 'g2', name: 'เงินสำรองฉุกเฉิน', target: m(10000000), saved: m(2500000), monthlyReserve: m(0), progressPercent: 25, isReached: false, periodsToGoal: null },
  ],
  '/dreams': {
    templates: [
      ['home', 'บ้านหลังแรก', '🏠', 'planning', 30_000_000, 5, 'เงินดาวน์ + ค่าโอน ประมาณ 10–15% ของราคาบ้าน'],
      ['travel', 'เที่ยวต่างประเทศ', '✈️', 'excited', 8_000_000, 1, 'ตั๋ว ที่พัก กิน เที่ยว'],
      ['retire', 'เกษียณสบาย', '🌴', 'sleepy', 300_000_000, 25, 'ค่าใช้จ่ายต่อเดือนหลังเกษียณ × 12 × จำนวนปี'],
      ['business', 'เปิดร้านของตัวเอง', '🏪', 'smart', 20_000_000, 3, 'ค่าตกแต่ง อุปกรณ์ สต็อกแรก'],
      ['car', 'รถคันแรก', '🚗', 'happy', 15_000_000, 2, 'เงินดาวน์ ประกันปีแรก'],
      ['education', 'ทุนการศึกษา', '🎓', 'smart', 30_000_000, 5, 'ค่าเทอม + ค่าครองชีพ'],
      ['wedding', 'งานแต่งในฝัน', '💍', 'celebrating', 30_000_000, 2, 'สินสอด งานเลี้ยง ฮันนีมูน'],
      ['freedom', 'อิสรภาพทางการเงิน', '🦅', 'proud', 100_000_000, 10, 'เงินก้อนที่ทำให้เลือกชีวิตได้'],
      ['custom', 'ความฝันของฉัน', '⭐', 'encouraging', 5_000_000, 1, 'ตั้งชื่อเองได้เลย'],
    ].map(([kind, label, emoji, mascot, s, y, hint]) => ({ kind, label, emoji, mascot, suggested: m(s as number), suggestedYears: y, hint })),
    items: [
      {
        id: 'd1', kind: 'home', name: 'คอนโดใกล้ที่ทำงาน', emoji: '🏠', mascot: 'planning', target: m(30_000_000), saved: m(8_400_000), remaining: m(21_600_000),
        targetDate: '2030-11-22', progressPercent: 28, monthsLeft: 48, monthlyNeeded: m(450_000), status: 'ahead', milestone: 25,
        next: { percent: 50, amountToGo: m(6_600_000) }, coach: { mascot: 'proud', headline: 'นำหน้าแผนไปแล้ว! 🚀', body: 'เก่งมาก ตอนนี้เกินแผนแล้ว อีก ฿66,000 ถึงด่าน 50% เดือนละ ฿4,500 ก็สบายๆ' },
        reserving: true, illustrations: [{ ratePercent: 2, monthly: m(410_000), savesPerMonth: m(40_000) }, { ratePercent: 5, monthly: m(360_000), savesPerMonth: m(90_000) }],
      },
      {
        id: 'd2', kind: 'travel', name: 'เที่ยวญี่ปุ่นกับแม่', emoji: '✈️', mascot: 'excited', target: m(6_000_000), saved: m(900_000), remaining: m(5_100_000),
        targetDate: '2027-10-01', progressPercent: 15, monthsLeft: 10, monthlyNeeded: m(510_000), status: 'behind', milestone: 10,
        next: { percent: 25, amountToGo: m(600_000) }, coach: { mascot: 'encouraging', headline: 'ช้ากว่าแผนนิดหน่อย ไม่เป็นไรนะ', body: 'เดือนนี้เก็บให้ได้ ฿5,100 ก็ยังไปถึงทันเวลา ค่อยๆ ไปด้วยกัน ชิกชิกอยู่ข้างๆ เสมอ 💪' },
        reserving: false, illustrations: [],
      },
    ],
  },
  '/reports/statement': {
    name: 'ปาล์ม', generatedOn: today, range: { start: '2026-11-01', end: today }, days: 18,
    income: m(2500000), expense: m(432000), saving: m(110100), net: m(1957900), keptPercent: 82,
    months: [{ key: '2026-11', income: m(2500000), expense: m(432000), saving: m(110100), net: m(1957900) }],
    incomeByCategory: [{ id: 'salary', label: 'เงินเดือน', amount: m(2500000), count: 1, percent: 100 }],
    expenseByCategory: [{ id: 'food', label: 'อาหาร', amount: m(186000), count: 21, percent: 43 }, { id: 'transport', label: 'เดินทาง', amount: m(95000), count: 6, percent: 21 }, { id: 'bills', label: 'บิล/ค่าบริการ', amount: m(59900), count: 1, percent: 13 }],
    rows: txns.map((t) => ({ date: t.date, type: t.type, category: t.category.label, note: t.note, amount: t.amount })),
  },
};

/** Demo calculator: same monthly-compounding maths as the API, client-side. */
function demoCompound(body: { monthly?: string; rateBp?: number; years?: number }) {
  const monthly = Math.round(Number(body.monthly ?? 0) * 100);
  const r = (body.rateBp ?? 0) / 10_000 / 12;
  const series = [];
  let bal = 0;
  for (let y = 0; y <= (body.years ?? 1); y++) {
    series.push({ year: y, deposited: m(monthly * 12 * y), balance: m(Math.round(bal)) });
    for (let i = 0; i < 12; i++) bal = bal * (1 + r) + monthly;
  }
  const last = series.at(-1)!;
  return { deposited: last.deposited, balance: last.balance, growth: m(Math.max(0, last.balance.satang - last.deposited.satang)), series };
}

export async function demoApi<T>(path: string, method: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 250));
  const route = path.split('?')[0]!;
  if (method === 'POST' && route === '/learn/compound') return demoCompound(body as never) as T;
  if (method !== 'GET') return {} as T;
  if (route === '/transactions') return { items: txns, hasMore: false, page: 0 } as T;
  return (ROUTES[route] ?? {}) as T;
}
