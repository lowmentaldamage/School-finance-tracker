import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../components/ui';
import { cn } from '../lib/cn';
import { useQuickAdd } from '../features/transactions/QuickAdd';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

export function Shell() {
  const { t } = useTranslation();
  const quickAdd = useQuickAdd();
  const items: NavItem[] = [
    { to: '/transactions', label: t('nav.transactions'), icon: 'list' },
    { to: '/accounts', label: t('nav.accounts'), icon: 'wallet' },
    { to: '/categories', label: t('nav.categories'), icon: 'tag' },
    { to: '/settings', label: t('nav.settings'), icon: 'settings' },
  ];

  return (
    <div className="flex h-full">
      <aside className="hidden w-[228px] shrink-0 flex-col border-r border-border bg-bg md:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <img src="/icon.svg" alt="" className="size-6 rounded-[6px]" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Keel</span>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => quickAdd.open()}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text shadow-sm hover:bg-surface-2"
          >
            <Icon name="plus" />
            {t('transactions.add')}
            <kbd className="ml-auto rounded-sm border border-border px-1 text-[11px] font-normal text-faint">N</kbd>
          </button>
        </div>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5 px-3">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-100',
                  isActive ? 'bg-surface-3 font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                )
              }
            >
              <Icon name={it.icon} />
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top)]">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {items.slice(0, 2).map((it) => (
          <MobileTab key={it.to} {...it} />
        ))}
        <button
          type="button"
          onClick={() => quickAdd.open()}
          aria-label={t('transactions.add')}
          className="flex h-16 items-center justify-center"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-text text-bg shadow-md">
            <Icon name="plus" size={20} />
          </span>
        </button>
        {items.slice(2).map((it) => (
          <MobileTab key={it.to} {...it} />
        ))}
      </nav>
    </div>
  );
}

function MobileTab({ to, label, icon }: NavItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'font-medium text-text' : 'text-faint')
      }
    >
      <Icon name={icon} size={20} />
      {label}
    </NavLink>
  );
}
