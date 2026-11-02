import { useTranslation } from 'react-i18next';

import { useConfirmOccurrence, useSkipOccurrence } from '../../api/hooks';
import type { Occurrence } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { Amount, Badge, Button, useToast } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { humanize } from '../../lib/errors';

/** One scheduled occurrence. Due ones can be booked or skipped in one tap. */
export function OccurrenceRow({ o }: { o: Occurrence }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirmOccurrence();
  const skip = useSkipOccurrence();

  async function run(kind: 'confirm' | 'skip') {
    try {
      if (kind === 'confirm') {
        await confirm.mutateAsync({ o });
        toast(t('recurring.booked'));
      } else {
        await skip.mutateAsync(o);
        toast(t('recurring.skipped'));
      }
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.category_color ?? 'var(--text-faint)' }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-text">{o.title}</span>
          {o.due && <Badge tone="warning">{t('recurring.due')}</Badge>}
        </span>
        <span className="block truncate text-[12px] text-muted">
          {formatDate(o.date, locale)} · {o.account_name}
        </span>
      </span>
      <Amount minor={o.amount_minor} currency={o.currency} type={o.type} className="text-sm font-medium" />
      {o.due && (
        <span className="flex w-full justify-end gap-1.5 sm:w-auto">
          <Button size="sm" variant="ghost" onClick={() => void run('skip')} loading={skip.isPending}>
            {t('recurring.skip')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void run('confirm')} loading={confirm.isPending}>
            {t('recurring.confirm')}
          </Button>
        </span>
      )}
    </li>
  );
}
