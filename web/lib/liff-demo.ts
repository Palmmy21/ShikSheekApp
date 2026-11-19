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
};

export async function demoApi<T>(path: string, method: string): Promise<T> {
  await new Promise((r) => setTimeout(r, 250));
  if (method !== 'GET') return {} as T;
  const route = path.split('?')[0]!;
  if (route === '/transactions') return { items: txns, hasMore: false, page: 0 } as T;
  return (ROUTES[route] ?? {}) as T;
}
