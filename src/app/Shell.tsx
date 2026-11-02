import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Dialog, Icon, type IconName } from '../components/ui';
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
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary: NavItem[] = [
    { to: '/overview', label: t('nav.overview'), icon: 'home' },
    { to: '/transactions', label: t('nav.transactions'), icon: 'list' },
    { to: '/budgets', label: t('nav.budgets'), icon: 'gauge' },
    { to: '/analytics', label: t('nav.analytics'), icon: 'chart' },
    { to: '/recurring', label: t('nav.recurring'), icon: 'repeat' },
    { to: '/goals', label: t('nav.goals'), icon: 'target' },
  ];
  const secondary: NavItem[] = [
    { to: '/accounts', label: t('nav.accounts'), icon: 'wallet' },
    { to: '/categories', label: t('nav.categories'), icon: 'tag' },
    { to: '/settings', label: t('nav.settings'), icon: 'settings' },
  ];
  // Mobile: four tabs plus the central Add button; everything else lives under More.
  const tabs = [primary[0]!, primary[1]!, primary[2]!];
  const more = [primary[3]!, primary[4]!, primary[5]!, ...secondary];
  const moreActive = more.some((i) => location.pathname.startsWith(i.to));

  const link = (it: NavItem) => (
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
  );

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
        <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-0.5 px-3">
          {primary.map(link)}
          <div className="my-3 h-px bg-border" />
          {secondary.map(link)}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top)]">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <MobileTab {...tabs[0]!} />
        <MobileTab {...tabs[1]!} />
        <button type="button" onClick={() => quickAdd.open()} aria-label={t('transactions.add')} className="flex h-16 items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-text text-bg shadow-md">
            <Icon name="plus" size={20} />
          </span>
        </button>
        <MobileTab {...tabs[2]!} />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px]', moreActive ? 'font-medium text-text' : 'text-faint')}
          aria-haspopup="dialog"
        >
          <Icon name="grid" size={20} />
          {t('nav.more')}
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title={t('nav.more')} size="sm">
        <ul className="-mx-2 flex flex-col">
          {more.map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) => cn('flex h-12 items-center gap-3 rounded-md px-3 text-[15px]', isActive ? 'bg-surface-2 font-medium text-text' : 'text-text')}
              >
                <Icon name={it.icon} size={18} className="text-muted" />
                {it.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

function MobileTab({ to, label, icon }: NavItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'font-medium text-text' : 'text-faint')}
    >
      <Icon name={icon} size={20} />
      {label}
    </NavLink>
  );
}
