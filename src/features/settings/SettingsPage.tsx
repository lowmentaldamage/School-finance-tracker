import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrencies, useSetSetting, useSettings } from '../../api/hooks';
import type { Theme } from '../../api/types';
import { Button, Input, Page, PageHeader, Panel, Segmented, Select, useToast } from '../../components/ui';
import { humanize } from '../../lib/errors';
import { defaultLocale, formatMoney } from '../../lib/money';
import { DataPanel } from './DataPanel';
import { RemindersPanel } from './RemindersPanel';
import { SyncPanel } from '../sync/SyncPanel';
import { RatesPanel } from './RatesPanel';
import { SecurityPanel } from './SecurityPanel';

const LOCALES = ['system', 'en-IE', 'en-GB', 'en-US', 'de-DE', 'fr-FR', 'nl-NL', 'es-ES', 'it-IT', 'pt-PT', 'pl-PL', 'sv-SE', 'fi-FI', 'de-CH'];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0 sm:w-[280px]">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useSettings();
  const currencies = useCurrencies();
  const set = useSetSetting();

  const [name, setName] = useState('');
  useEffect(() => setName(settings.data?.['profile.display_name'] ?? ''), [settings.data]);

  async function save(key: Parameters<typeof set.mutateAsync>[0]['key'], value: unknown, msg = t('settings.saved')) {
    try {
      await set.mutateAsync({ key, value });
      toast(msg);
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  const s = settings.data ?? {};
  const locale = s['locale.number'] ?? 'system';
  const effectiveLocale = locale === 'system' ? defaultLocale() : locale;

  return (
    <Page>
      <PageHeader title={t('nav.settings')} />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        <Panel title={t('settings.profile')}>
          <Row label={t('settings.display_name')}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save('profile.display_name', name.trim().slice(0, 60));
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label={t('settings.display_name')} />
              <Button type="submit" disabled={name.trim() === (s['profile.display_name'] ?? '')}>
                {t('common.save')}
              </Button>
            </form>
          </Row>
        </Panel>

        <Panel title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented<Theme>
              label={t('settings.theme')}
              value={s.theme ?? 'system'}
              onChange={(v) => void save('theme', v)}
              options={[
                { value: 'system', label: t('settings.theme_system') },
                { value: 'light', label: t('settings.theme_light') },
                { value: 'dark', label: t('settings.theme_dark') },
              ]}
              className="w-full"
            />
          </Row>
        </Panel>

        <Panel title={t('settings.regional')}>
          <div className="divide-y divide-border">
            <Row label={t('settings.base_currency')} hint={t('settings.base_currency_hint')}>
              <Select value={s.base_currency ?? 'EUR'} onChange={(e) => void save('base_currency', e.target.value)} aria-label={t('settings.base_currency')}>
                {(currencies.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label={t('settings.format')} hint={t('settings.format_example', { example: `${formatMoney(123456789, s.base_currency ?? 'EUR', { locale: effectiveLocale })} · ${new Intl.DateTimeFormat(effectiveLocale, { dateStyle: 'medium' }).format(new Date())}` })}>
              <Select
                value={locale}
                onChange={(e) => {
                  void save('locale.number', e.target.value);
                  void save('locale.date', e.target.value);
                }}
                aria-label={t('settings.format')}
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l === 'system' ? t('settings.format_system', { locale: defaultLocale() }) : l}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </Panel>

        <RatesPanel />

        <SecurityPanel />

        <RemindersPanel />

        <SyncPanel />

        <DataPanel />

        <p className="text-[12.5px] text-faint">{t('settings.version', { version: __APP_VERSION__ })}</p>
      </div>
    </Page>
  );
}
