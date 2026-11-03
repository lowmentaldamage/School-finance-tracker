import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { call } from '../../api/client';
import { useBudgetMonth, useSetSetting, useSettings } from '../../api/hooks';
import type { Upcoming } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { formatMoney } from '../../lib/money';
import { hashId, isAndroidApp, native } from '../../lib/native';
import { monthKey } from '../../lib/period';

/** Keeps phone reminders in step with the data: bills the day before, budgets when they cross 80 %/100 %. */
export function ReminderScheduler() {
  const { t } = useTranslation();
  const locale = useLocale();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const bills = settings.data?.['notifications.bills'] === true;
  const budgetsOn = settings.data?.['notifications.budgets'] === true;
  const month = monthKey();
  const upcoming = useQuery({
    queryKey: ['recurring', 'upcoming', 'reminders'],
    queryFn: () => call<Upcoming>('recurring.upcoming', { days: 21 }),
    enabled: isAndroidApp() && bills,
  });
  const budget = useBudgetMonth(month);

  useEffect(() => {
    if (!isAndroidApp() || !settings.isSuccess) return;
    const items = bills
      ? (upcoming.data?.items ?? [])
          .filter((o) => !o.due && o.type !== 'transfer')
          .map((o) => {
            const [y, m, d] = o.date.split('-').map(Number);
            const at = new Date(y!, m! - 1, d! - 1, 9, 0, 0).getTime();
            return {
              id: hashId(`${o.rule_id}:${o.date}`),
              at,
              title: t(o.type === 'income' ? 'reminders.income_tomorrow' : 'reminders.due_tomorrow', { name: o.title }),
              body: formatMoney(o.amount_minor, o.currency, { locale }),
            };
          })
      : [];
    void native('scheduleReminders', { items: JSON.stringify(items) }).catch(() => undefined);
  }, [bills, upcoming.data, settings.isSuccess]);

  useEffect(() => {
    if (!isAndroidApp() || !budgetsOn || !budget.data) return;
    const sent = new Set(settings.data?.['notifications.budget_sent'] ?? []);
    let changed = false;
    for (const l of [...budget.data.lines, ...(budget.data.overall ? [budget.data.overall] : [])]) {
      if (l.status === 'ok') continue;
      const key = `${month}:${l.category_id ?? 'all'}:${l.status}`;
      if (sent.has(key)) continue;
      sent.add(key);
      changed = true;
      const name = l.name ?? t('budgets.overall');
      void native('showReminder', {
        id: hashId(key),
        title: t(l.status === 'over' ? 'reminders.budget_over' : 'reminders.budget_near', { name }),
        body: t('budgets.spent_of', {
          spent: formatMoney(l.spent_minor, budget.data.currency, { locale }),
          available: formatMoney(l.available_minor, budget.data.currency, { locale }),
        }),
      }).catch(() => undefined);
    }
    if (changed) {
      const keep = [...sent].filter((k) => k >= monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1))).slice(-400);
      setSetting.mutate({ key: 'notifications.budget_sent', value: keep });
    }
  }, [budgetsOn, budget.data]);

  return null;
}
