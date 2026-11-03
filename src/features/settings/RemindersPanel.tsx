import { useTranslation } from 'react-i18next';

import { useSetSetting, useSettings } from '../../api/hooks';
import { Checkbox, Panel, useToast } from '../../components/ui';
import { isAndroidApp, native } from '../../lib/native';

export function RemindersPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useSettings();
  const set = useSetSetting();
  if (!isAndroidApp()) return null;

  async function toggle(key: 'notifications.bills' | 'notifications.budgets', on: boolean) {
    if (on) {
      const r = await native<{ granted: boolean }>('notifyPermission').catch(() => ({ granted: false }));
      if (!r.granted) {
        toast(t('reminders.permission_denied'), 'negative');
        return;
      }
    }
    set.mutate({ key, value: on });
  }

  return (
    <Panel title={t('reminders.title')}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <p className="text-[12.5px] text-muted">{t('reminders.intro')}</p>
        <Checkbox label={t('reminders.bills')} checked={settings.data?.['notifications.bills'] === true} onChange={(e) => void toggle('notifications.bills', e.target.checked)} />
        <Checkbox label={t('reminders.budgets')} checked={settings.data?.['notifications.budgets'] === true} onChange={(e) => void toggle('notifications.budgets', e.target.checked)} />
      </div>
    </Panel>
  );
}
