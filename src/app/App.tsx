import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAppStatus, useSettings } from '../api/hooks';
import { Button, ErrorState, Spinner, ToastProvider } from '../components/ui';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { BudgetsPage } from '../features/budgets/BudgetsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { RecurringPage } from '../features/recurring/RecurringPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { AutoLock } from '../features/lock/AutoLock';
import { ReminderScheduler } from '../features/reminders/ReminderScheduler';
import { AutoBackupRunner } from '../features/settings/AutoBackupRunner';
import { SyncRunner } from '../features/sync/SyncRunner';
import { LockScreen } from '../features/lock/LockScreen';
import { Onboarding } from '../features/onboarding/Onboarding';
import { SettingsPage } from '../features/settings/SettingsPage';
import { QuickAddProvider } from '../features/transactions/QuickAdd';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { useThemeSync } from './preferences';
import { Shell } from './Shell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
    mutations: { retry: false },
  },
});

const router = createHashRouter([
  {
    element: (
      <QuickAddProvider>
        <Shell />
      </QuickAddProvider>
    ),
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <DashboardPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'budgets', element: <BudgetsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'recurring', element: <RecurringPage /> },
      { path: 'goals', element: <GoalsPage /> },
      { path: 'accounts', element: <AccountsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/overview" replace /> },
    ],
  },
]);

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-bg">{children}</div>;
}

/** Settings can only be read while the database is open. */
function useSettingsWhen(ready: boolean) {
  const s = useSettings(ready);
  return s;
}

function Gate() {
  const { t } = useTranslation();
  useThemeSync();
  const status = useAppStatus();
  const ready = status.data?.ready === true;
  const settings = useSettingsWhen(ready);
  const settingsReady = ready && settings.isSuccess;

  if (status.isLoading || (ready && settings.isLoading)) {
    return (
      <FullScreen>
        <Spinner className="text-faint" />
      </FullScreen>
    );
  }
  if (status.data?.locked) {
    return <LockScreen status={status.data} />;
  }
  if (!ready || settings.isError) {
    const message = status.data?.error?.message ?? (settings.error as Error | null)?.message;
    return (
      <FullScreen>
        <ErrorState
          title={t('app.cannot_open')}
          message={message}
          action={<Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>}
        />
      </FullScreen>
    );
  }
  if (settingsReady && settings.data['onboarding.completed'] !== true) {
    return <Onboarding />;
  }
  return (
    <>
      <AutoLock status={status.data!} />
      <ReminderScheduler />
      <AutoBackupRunner />
      <SyncRunner />
      <RouterProvider router={router} />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </QueryClientProvider>
  );
}
