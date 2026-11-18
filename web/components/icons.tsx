/**
 * One icon language for the whole product: Lucide line icons (2px stroke, round caps), sat in soft
 * tinted circles. Category ids match the backend (src/domain/entities/categories.ts).
 */
import {
  Briefcase, Car, Clapperboard, GraduationCap, Gift, HeartPulse, House, Laptop, Package, PartyPopper,
  PawPrint, PiggyBank, Receipt, ShoppingBag, TrendingUp, Undo2, Users, UtensilsCrossed, Wallet,
  type LucideIcon,
} from 'lucide-react';

type Tint = 'red' | 'yellow' | 'green' | 'blue' | 'violet' | 'brown';

const CATEGORY: Record<string, { icon: LucideIcon; tint: Tint }> = {
  food: { icon: UtensilsCrossed, tint: 'red' },
  transport: { icon: Car, tint: 'blue' },
  shopping: { icon: ShoppingBag, tint: 'violet' },
  bills: { icon: Receipt, tint: 'yellow' },
  health: { icon: HeartPulse, tint: 'green' },
  entertainment: { icon: Clapperboard, tint: 'violet' },
  home: { icon: House, tint: 'brown' },
  education: { icon: GraduationCap, tint: 'blue' },
  family: { icon: Users, tint: 'red' },
  pet: { icon: PawPrint, tint: 'brown' },
  other_expense: { icon: Package, tint: 'brown' },
  salary: { icon: Briefcase, tint: 'green' },
  bonus: { icon: PartyPopper, tint: 'yellow' },
  freelance: { icon: Laptop, tint: 'green' },
  gift_income: { icon: Gift, tint: 'red' },
  investment: { icon: TrendingUp, tint: 'green' },
  refund: { icon: Undo2, tint: 'blue' },
  other_income: { icon: Wallet, tint: 'green' },
  savings: { icon: PiggyBank, tint: 'yellow' },
  total: { icon: Wallet, tint: 'brown' },
};

export function CategoryIcon({ id, size = 36 }: { id: string; size?: number }) {
  const c = CATEGORY[id] ?? CATEGORY.other_expense!;
  const Icon = c.icon;
  return (
    <span className={`ico ico--${c.tint}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

export function TintIcon({ icon: Icon, tint = 'red', size = 44 }: { icon: LucideIcon; tint?: Tint; size?: number }) {
  return (
    <span className={`ico ico--${tint}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}
