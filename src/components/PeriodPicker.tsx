import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import type { DateRange } from '../api/types';
import { PERIOD_KEYS, periodToRange, type PeriodKey } from '../lib/period';
import { Input, Select } from './ui';

/** Period stored in the URL (?p=…&from=…&to=…) so it survives navigation. */
export function usePeriod(defaultKey: PeriodKey): { key: PeriodKey; range: DateRange; set: (k: PeriodKey, custom?: DateRange) => void } {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('p') as PeriodKey | null;
  const key: PeriodKey = raw && PERIOD_KEYS.includes(raw) ? raw : defaultKey;
  const custom = { from: sp.get('from') ?? '', to: sp.get('to') ?? '' };
  const range = useMemo(() => periodToRange(key, custom), [key, custom.from, custom.to]);
  const set = (k: PeriodKey, c?: DateRange) => {
    const next = new URLSearchParams(sp);
    next.set('p', k);
    if (k === 'custom') {
      const r = c ?? range;
      next.set('from', r.from);
      next.set('to', r.to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    setSp(next, { replace: true });
  };
  return { key, range, set };
}

export function PeriodPicker({ value, range, onChange }: { value: PeriodKey; range: DateRange; onChange: (k: PeriodKey, c?: DateRange) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t('period.label')} value={value} onChange={(e) => onChange(e.target.value as PeriodKey)} className="w-[170px]">
        {PERIOD_KEYS.map((k) => (
          <option key={k} value={k}>
            {t(`period.${k}`)}
          </option>
        ))}
      </Select>
      {value === 'custom' && (
        <>
          <Input type="date" aria-label={t('filters.from')} value={range.from} max={range.to} onChange={(e) => e.target.value && onChange('custom', { from: e.target.value, to: range.to })} className="w-[150px]" />
          <Input type="date" aria-label={t('filters.to')} value={range.to} min={range.from} onChange={(e) => e.target.value && onChange('custom', { from: range.from, to: e.target.value })} className="w-[150px]" />
        </>
      )}
    </div>
  );
}
