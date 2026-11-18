/**
 * Every template rendered with realistic AND edge-case data (long names, negative balances, empty
 * states). Used by tests (offline structural validation) and scripts/validate-flex.ts (LINE API).
 */
import type { DashboardView, SummaryView } from '../../src/application/services/finance-service.ts';
import type { FixedCostSummary } from '../../src/application/services/fixed-cost-service.ts';
import { calculateAvailable } from '../../src/domain/calculations/available.ts';
import { computeBudgetStatus } from '../../src/domain/calculations/budget.ts';
import { computeSavingsProgress } from '../../src/domain/calculations/savings.ts';
import { summarizeTransactions } from '../../src/domain/calculations/summary.ts';
import type { FixedCost, FixedCostOccurrence, Transaction, UserProfile } from '../../src/domain/entities/index.ts';
import { DEFAULT_NOTIFICATION_PREFS } from '../../src/domain/entities/index.ts';
import { periodFromKey } from '../../src/domain/period.ts';
import type { Message } from '../../src/infrastructure/line/messages.ts';
import { configureAssetBaseUrl } from '../../src/presentation/line/mascot.ts';
import { budgetCategoryPickerMessage, budgetsOverviewMessage, budgetWarningMessage, confirmGoalMessage, goalAddPrompt, goalsOverviewMessage } from '../../src/presentation/line/flex/budgets-goals.ts';
import { errorMessage, helpMessage, mascotSays, onboardingCycleMessage, onboardingIncomeMessage, staleActionMessage, welcomeMessage } from '../../src/presentation/line/flex/common.ts';
import { dashboardMessage, reportsMenuMessage, summaryMessage } from '../../src/presentation/line/flex/dashboard-reports.ts';
import { confirmDeleteFixedCostMessage, confirmFixedCostMessage, fixedCostAddPrompt, fixedCostDetailMessage, fixedCostOverviewMessage, payConfirmMessage, upcomingBillsMessage } from '../../src/presentation/line/flex/fixed-costs.ts';
import { cycleSettingMessage, deleteDataConfirmMessage, settingsMessage } from '../../src/presentation/line/flex/settings.ts';
import { autoRecordMessage, multiConfirmMessage, multiSavedMessage, askAmountMessage, categoryPickerMessage, confirmDeleteMessage, confirmTransactionMessage, deletedMessage, historyMessage, startEntryMessage, transactionSavedMessage } from '../../src/presentation/line/flex/transactions.ts';
import { toOccurrenceView } from '../../src/domain/calculations/bills.ts';
import { importSummaryMessage } from '../../src/presentation/line/flex/imports.ts';
import { saveFirstMessage, sweepMessage, wealthPlanMessage } from '../../src/presentation/line/flex/wealth.ts';
import { scanPrompt } from '../../src/presentation/line/handlers/views.ts';
import { checkoutMessage, paidMessage, planLimitMessage, planStatusMessage, renewalMessage } from '../../src/presentation/line/flex/plans.ts';
import { PlanLimitError } from '../../src/application/services/entitlement-service.ts';
import { PLANS } from '../../src/domain/plans.ts';

const U = 'U' + '0'.repeat(31) + '1';
const TODAY = '2026-11-18';
const UUID = '7d6e2b0a-1c3f-4a5b-9c8d-0e1f2a3b4c5d';
const LONG = 'ค่าผ่อนคอนโดริมแม่น้ำเจ้าพระยาชั้นสามสิบสองห้องมุมวิวสวย';

const txn = (p: Partial<Transaction>): Transaction => ({
  id: UUID, userId: U, type: 'expense', amountSatang: 6_500, categoryId: 'food', note: 'กินข้าว', txnDate: TODAY,
  source: 'chat', fixedCostOccurrenceId: null, savingsGoalId: null, externalRef: null, createdAt: '', deletedAt: null, ...p,
});
const fc = (p: Partial<FixedCost> = {}): FixedCost => ({
  id: UUID, userId: U, name: 'ค่าห้อง', amountSatang: 650_000, categoryId: 'bills', frequency: 'monthly', interval: 1,
  anchorDate: '2026-11-25', endDate: null, remindDaysBefore: 1, status: 'active', activeFrom: '2026-11-01', ...p,
});
const occ = (p: Partial<FixedCostOccurrence> = {}): FixedCostOccurrence => ({
  id: UUID, userId: U, fixedCostId: UUID, occurrenceKey: 'M2026-11', dueDate: '2026-11-25', amountSatang: 650_000, status: 'pending', ...p,
});
const user: UserProfile = { userId: U, displayName: 'ปาล์ม', cycleStartDay: 1, notifications: DEFAULT_NOTIFICATION_PREFS, onboarding: 'done', isFollowing: true, autoRecord: false, createdAt: '' };

export function buildSamples(): Record<string, Message[]> {
  configureAssetBaseUrl('https://example.supabase.co/storage/v1/object/public/assets');
  const period = periodFromKey('2026-11');
  const txns = [
    txn({ type: 'income', categoryId: 'salary', amountSatang: 2_500_000, txnDate: '2026-11-01', note: 'เงินเดือน' }),
    txn({}), txn({ categoryId: 'transport', amountSatang: 50_000, note: 'เติมน้ำมัน' }), txn({ categoryId: 'shopping', amountSatang: 129_900, note: LONG }),
  ];
  const occurrences = [occ(), occ({ dueDate: '2026-11-10', amountSatang: 59_900, occurrenceKey: 'M2026-11b' })];
  const available = calculateAvailable({ period, today: TODAY, transactions: txns, occurrences, savingsGoals: [] });
  const negative = calculateAvailable({ period, today: TODAY, transactions: [txns[1]!], occurrences, savingsGoals: [] });
  const budget = computeBudgetStatus({ id: UUID, userId: U, categoryId: 'food', limitSatang: 500_000 }, 420_000);
  const over = computeBudgetStatus({ id: UUID, userId: U, categoryId: 'total', limitSatang: 1_000_000 }, 1_350_000);
  const totals = summarizeTransactions(txns, { start: period.start, end: period.end });
  const bills = occurrences.map((o) => toOccurrenceView(o, TODAY));
  const dash: DashboardView = { user, period, today: TODAY, available, totals, todayExpenseSatang: 186_400, upcomingBills: bills, fixedCostNames: { [UUID]: 'ค่าห้อง' }, budgets: [budget, over] };
  const summary = (label: SummaryView['label']): SummaryView => ({
    label, start: label === 'day' ? TODAY : period.start, end: label === 'day' ? TODAY : period.end, totals, previousTotals: totals,
    expenseChangeSatang: label === 'week' ? -12_000 : 34_500, available: label === 'week' ? null : available, budgets: [budget], topExpenseNote: 'กินข้าว',
  });
  const goal = { id: UUID, userId: U, name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 300_000, targetDate: null, status: 'active' as const };
  const fcSummaries: FixedCostSummary[] = [
    { fixedCost: fc(), next: bills[0]!, overdue: [] },
    { fixedCost: fc({ name: LONG, frequency: 'weekly', status: 'paused' }), next: null, overdue: [] },
    { fixedCost: fc({ name: 'ค่าเน็ต', amountSatang: 59_900 }), next: null, overdue: [bills[1]!] },
  ];
  const draft = { type: 'expense' as const, amountSatang: 6_500, categoryId: 'other_expense', categoryConfident: false, note: 'ฟหกด', txnDate: '2026-11-19', source: 'chat' as const };

  return {
    welcome: [welcomeMessage('ปาล์ม')],
    welcome_no_name: [welcomeMessage(null)],
    onboarding_cycle: [onboardingCycleMessage()],
    onboarding_income: [onboardingIncomeMessage()],
    help: [helpMessage()],
    error: [errorMessage()],
    stale: [staleActionMessage()],
    personality: [mascotSays('หวัดดีจ้า! วันนี้มีอะไรให้ชิกชิกจดบ้าง? 🐔', 'happy')],
    dashboard: [dashboardMessage(dash, 'การเงินดูดีมาก ชิกชิกยิ้มแก้มปริ ✨')],
    dashboard_negative: [dashboardMessage({ ...dash, available: negative, upcomingBills: [], budgets: [] }, 'ติดลบแล้วน้า')],
    confirm_txn: [confirmTransactionMessage(UUID, draft, TODAY), categoryPickerMessage(UUID, 'expense')],
    confirm_saving: [confirmTransactionMessage(UUID, { ...draft, type: 'saving', categoryId: 'savings', categoryConfident: true, savingsGoalId: UUID }, TODAY, 'เที่ยวญี่ปุ่น')],
    txn_saved: [transactionSavedMessage(txn({}), TODAY, 'จดให้แล้วจ้า', 'happy', { todayExpenseSatang: 6_500, availableSatang: -12_345, dailyAllowanceSatang: 0 })],
    txn_saved_income: [transactionSavedMessage(txn({ type: 'income', categoryId: 'salary', amountSatang: 2_500_000 }), TODAY, 'เย้!', 'celebrating', { availableSatang: 2_000_000, dailyAllowanceSatang: 153_846 })],
    history: [historyMessage(Array.from({ length: 10 }, (_, i) => txn({ note: i === 3 ? LONG : 'กาแฟ', amountSatang: 8_000 + i, type: i % 4 === 0 ? 'income' : 'expense' })), 1, true, TODAY)],
    history_empty: [historyMessage([], 0, false, TODAY)],
    start_entry: [startEntryMessage('expense'), startEntryMessage('income'), askAmountMessage('food')],
    delete_flow: [confirmDeleteMessage(txn({ fixedCostOccurrenceId: UUID }), TODAY), deletedMessage(txn({}))],
    fixed_overview: [fixedCostOverviewMessage(fcSummaries)],
    fixed_overview_empty: [fixedCostOverviewMessage([])],
    fixed_detail: [fixedCostDetailMessage(fc(), [occ(), occ({ status: 'paid', dueDate: '2026-10-25' }), occ({ status: 'skipped', dueDate: '2026-09-25' })], TODAY)],
    fixed_detail_paused: [fixedCostDetailMessage(fc({ status: 'paused', name: LONG }), [], TODAY)],
    pay_confirm: [payConfirmMessage(occ({ dueDate: '2026-11-10' }), fc(), TODAY)],
    bills: [upcomingBillsMessage(bills, { [UUID]: 'ค่าห้อง' }, 'ภายใน 7 วัน')],
    bills_single: [upcomingBillsMessage([bills[0]!], { [UUID]: 'ค่าห้อง' }, 'พรุ่งนี้ต้องจ่าย')],
    bills_empty: [upcomingBillsMessage([], {}, 'ภายใน 7 วัน')],
    bill_reminder: [upcomingBillsMessage(bills, { [UUID]: 'ค่าห้อง' }, 'อย่าลืมจ่ายบิลน้า', 'เตือนบิล 🔔', 'discipline')],
    fixed_add: [fixedCostAddPrompt(), confirmFixedCostMessage(UUID, { name: 'ค่าเน็ต', amountSatang: 59_900, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-12-05' }, firstDueDate: '2026-12-05' }), confirmDeleteFixedCostMessage(fc())],
    budgets: [budgetsOverviewMessage([over, budget], '1 พ.ย. – 30 พ.ย.')],
    budgets_empty: [budgetsOverviewMessage([], '1 พ.ย. – 30 พ.ย.'), budgetCategoryPickerMessage()],
    budget_warning: [budgetWarningMessage(budget, 80, 'ระวังๆ'), budgetWarningMessage(over, 100, 'เกินงบแล้ววว!')],
    goals: [goalsOverviewMessage([computeSavingsProgress(goal, [txn({ type: 'saving', categoryId: 'savings', amountSatang: 900_000, savingsGoalId: UUID })]), computeSavingsProgress({ ...goal, name: LONG, targetSatang: 100 }, [txn({ type: 'saving', savingsGoalId: UUID, amountSatang: 500 })])])],
    goals_empty: [goalsOverviewMessage([]), goalAddPrompt(), confirmGoalMessage(UUID, { name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 300_000 })],
    reports_menu: [reportsMenuMessage('2026-10')],
    daily_summary: [summaryMessage(summary('day'), 'จบอีกวัน!', 'happy')],
    weekly_summary: [summaryMessage(summary('week'), 'ประหยัดขึ้นนะเนี่ย', 'proud')],
    monthly_summary: [summaryMessage(summary('month'), 'ใช้มากกว่าเดือนก่อนนิดนึง', 'worried')],
    summary_empty: [summaryMessage({ ...summary('day'), totals: summarizeTransactions([], { start: TODAY, end: TODAY }), previousTotals: null, expenseChangeSatang: null, budgets: [] }, 'วันนี้เงียบๆ', 'proud')],
    settings: [settingsMessage(user), cycleSettingMessage(25), deleteDataConfirmMessage()],
    multi_confirm: [multiConfirmMessage(UUID, [draft, { ...draft, categoryId: 'food', categoryConfident: true, note: LONG, txnDate: TODAY }, { ...draft, type: 'income', categoryId: 'salary', categoryConfident: true, amountSatang: 2_500_000, note: 'เงินเดือน', txnDate: TODAY }], TODAY, { expenseSatang: 13_000, incomeSatang: 2_500_000 })],
    multi_saved: [multiSavedMessage(UUID, [txn({}), txn({ note: LONG, amountSatang: 4_000 })], TODAY, { expenseSatang: 10_500, incomeSatang: 0 }, 'จดให้แล้วจ้า', -12_345)],
    auto_record: [autoRecordMessage(true), autoRecordMessage(false)],
    confirm_slip: [confirmTransactionMessage(UUID, { ...draft, categoryId: 'food', categoryConfident: true, txnDate: TODAY, source: 'slip', note: 'ร้านกาแฟดอยช้าง', externalRef: 'ref:ABC123456' }, TODAY)],
    plans_free: [planStatusMessage({ plan: 'free', limits: PLANS.free, source: 'free', until: null, daysLeft: null }, { docs: 10, ai: 17, fixedCosts: 3, goals: 0 })],
    plans_trial: [planStatusMessage({ plan: 'pro', limits: PLANS.pro, source: 'trial', until: '2026-12-02T00:00:00Z', daysLeft: 14 }, { docs: 3, ai: 40, fixedCosts: 7, goals: 2 })],
    plans_paid: [planStatusMessage({ plan: 'plus', limits: PLANS.plus, source: 'paid', until: '2026-12-31T00:00:00Z', daysLeft: 43 }, { docs: 120, ai: 0, fixedCosts: 12, goals: 5 })],
    plan_limits: [planLimitMessage(new PlanLimitError('fixed_costs', 'free', 3)), planLimitMessage(new PlanLimitError('category_budget', 'free', null)), planLimitMessage(new PlanLimitError('docs', 'free', 10)), planLimitMessage(new PlanLimitError('goals', 'plus', 5)), planLimitMessage(new PlanLimitError('history', 'free', 2))],
    plans_payable: [planStatusMessage({ plan: 'free', limits: PLANS.free, source: 'free', until: null, daysLeft: null }, { docs: 2, ai: 5, fixedCosts: 1, goals: 1 }, { payable: true, earlyBird: true }), planStatusMessage({ plan: 'plus', limits: PLANS.plus, source: 'paid', until: '2026-12-31T00:00:00Z', daysLeft: 43 }, { docs: 2, ai: 5, fixedCosts: 1, goals: 1 }, { payable: true, earlyBird: false })],
    payments: [checkoutMessage(UUID, 'plus_early', 'https://sandbox-pgw-ui.2c2p.com/payment/4.5/#/token/abc'), paidMessage('pro', '2027-11-18T03:00:00Z'), renewalMessage('plus', '2026-12-18T03:00:00Z', false), renewalMessage('pro', '2026-12-18T03:00:00Z', true), planLimitMessage(new PlanLimitError('fixed_costs', 'free', 3), true)],
    wealth: [
      wealthPlanMessage({ period: periodFromKey('2026-11'), incomeSatang: 2_500_000, savingSatang: 300_000, savingsRateBp: 1200, avgMonthlyExpenseSatang: 1_500_000, emergencyTargetSatang: 4_500_000, emergency: null, goals: [], totalSavedSatang: 0, step: 1 }),
      wealthPlanMessage({ period: periodFromKey('2026-11'), incomeSatang: 2_500_000, savingSatang: 600_000, savingsRateBp: 2400, avgMonthlyExpenseSatang: 1_500_000, emergencyTargetSatang: 4_500_000, emergency: computeSavingsProgress({ ...goal, name: 'เงินสำรองฉุกเฉิน', targetSatang: 4_500_000 }, [txn({ type: 'saving', categoryId: 'savings', amountSatang: 4_500_000, savingsGoalId: UUID })]), goals: [computeSavingsProgress({ ...goal, id: '22222222-2222-4222-8222-222222222222', name: LONG }, [])], totalSavedSatang: 4_500_000, step: 3 }),
      saveFirstMessage(txn({ type: 'income', categoryId: 'salary', amountSatang: 2_512_345 })),
      sweepMessage('2026-10', 412_350),
      ...scanPrompt(),
    ],
    import_summary: [importSummaryMessage(UUID, { count: 42, incomeSatang: 2_500_000, expenseSatang: 1_834_550, firstDate: '2026-10-01', lastDate: '2026-10-31' }, Array.from({ length: 8 }, (_, i) => ({ type: i % 5 === 0 ? 'income' as const : 'expense' as const, amountSatang: 6_500 + i, categoryId: 'food', categoryConfident: true, note: i === 2 ? LONG : 'ร้านข้าว', txnDate: '2026-10-0' + (i + 1), dateGuessed: false, externalRef: null })), 3, 5)],
  };
}
