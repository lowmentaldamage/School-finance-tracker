import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrencies, useSaveAccount, useSetSetting } from '../../api/hooks';
import type { AccountKind } from '../../api/types';
import { Button, Field, Input, Select } from '../../components/ui';
import { todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, parseSignedAmount } from '../../lib/money';
import { ACCOUNT_KINDS } from '../accounts/AccountForm';
import { LockSetup } from '../lock/LockSetup';

/** First-run setup: currency, then the first account. No sample data is created. */
export function Onboarding() {
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const setSetting = useSetSetting();
  const saveAccount = useSaveAccount();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [accName, setAccName] = useState('');
  const [kind, setKind] = useState<AccountKind>('checking');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveStep1(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setSetting.mutateAsync({ key: 'base_currency', value: currency });
      if (displayName.trim()) await setSetting.mutateAsync({ key: 'profile.display_name', value: displayName.trim().slice(0, 60) });
      setStep(2);
    } catch (err) {
      setError(humanize(fieldError(err).message));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      await setSetting.mutateAsync({ key: 'onboarding.completed', value: true });
    } catch (err) {
      setError(humanize(fieldError(err).message));
      setBusy(false);
    }
  }

  async function finish(withAccount: boolean) {
    setError(null);
    if (withAccount) {
      if (!accName.trim()) {
        setError(t('onboarding.account_name_required'));
        return;
      }
      const liability = kind === 'credit_card' || kind === 'loan';
      let opening = 0;
      if (balance.trim()) {
        const v = parseSignedAmount(balance, currencyExponent(currency));
        if (v === null) {
          setError(t('validation.amount'));
          return;
        }
        opening = liability ? -v : v;
      }
      setBusy(true);
      try {
        await saveAccount.mutateAsync({
          input: { name: accName.trim(), kind, currency, opening_balance_minor: opening, opening_date: todayISO(), include_in_net_worth: true },
        });
      } catch (err) {
        setError(humanize(fieldError(err).message));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setStep(3);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-8 rounded-[8px]" />
          <span className="text-[17px] font-semibold tracking-[-0.01em]">Keel</span>
          <span className="tabular ml-auto text-[12.5px] text-faint">{t('onboarding.step', { step, total: 3 })}</span>
        </div>

        {step === 1 ? (
          <form onSubmit={saveStep1} className="rounded-lg border border-border bg-surface p-6 shadow-sm" noValidate>
            <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{t('onboarding.welcome_title')}</h1>
            <p className="mt-1.5 text-sm text-muted">{t('onboarding.welcome_body')}</p>
            <div className="mt-6 flex flex-col gap-4">
              <Field label={t('onboarding.display_name')} optional={t('common.optional')}>
                {(p) => <Input {...p} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} autoFocus />}
              </Field>
              <Field label={t('onboarding.currency')} hint={t('onboarding.currency_hint')}>
                {(p) => (
                  <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {(currencies.data ?? [{ code: 'EUR', name: 'Euro', minor_unit: 2 }]).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {error && (
              <p role="alert" className="mt-4 text-sm text-negative">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" className="mt-6 w-full" loading={busy}>
              {t('common.continue')}
            </Button>
          </form>
        ) : step === 3 ? (
          <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
            <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{t('onboarding.lock_title')}</h1>
            <p className="mt-1.5 mb-6 text-sm text-muted">{t('onboarding.lock_body')}</p>
            <LockSetup doneLabel={t('onboarding.finish')} onDone={() => void complete()} />
            {error && (
              <p role="alert" className="mt-4 text-sm text-negative">
                {error}
              </p>
            )}
            <Button variant="ghost" className="mt-3 w-full" disabled={busy} onClick={() => void complete()}>
              {t('onboarding.lock_skip')}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void finish(true);
            }}
            className="rounded-lg border border-border bg-surface p-6 shadow-sm"
            noValidate
          >
            <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{t('onboarding.account_title')}</h1>
            <p className="mt-1.5 text-sm text-muted">{t('onboarding.account_body')}</p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('accounts.name')} className="sm:col-span-2">
                {(p) => <Input {...p} value={accName} onChange={(e) => setAccName(e.target.value)} maxLength={80} autoFocus placeholder={t('accounts.name_placeholder')} />}
              </Field>
              <Field label={t('accounts.kind')}>
                {(p) => (
                  <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                    {ACCOUNT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`account_kind.${k}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={kind === 'credit_card' || kind === 'loan' ? t('accounts.opening_owed') : t('onboarding.current_balance')}>
                {(p) => <Input {...p} value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
              </Field>
            </div>
            {error && (
              <p role="alert" className="mt-4 text-sm text-negative">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                {t('common.continue')}
              </Button>
              <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void finish(false)}>
                {t('onboarding.skip')}
              </Button>
            </div>
          </form>
        )}
        <p className="mt-6 text-center text-[12.5px] text-faint">{t('onboarding.privacy')}</p>
      </div>
    </div>
  );
}
