import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { appStatus } from '../api/client';
import { useSettings } from '../api/hooks';
import { Button, ErrorState, Spinner, ToastProvider } from '../components/ui';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
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
      { index: true, element: <Navigate to="/transactions" replace /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'accounts', element: <AccountsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/transactions" replace /> },
    ],
  },
]);

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-bg">{children}</div>;
}

function Gate() {
  const { t } = useTranslation();
  useThemeSync();
  const status = useQuery({ queryKey: ['app-status'], queryFn: appStatus, staleTime: Infinity });
  const ready = status.data?.ready === true;
  const settings = useSettings();
  const settingsReady = ready && settings.isSuccess;

  if (status.isLoading || (ready && settings.isLoading)) {
    return (
      <FullScreen>
        <Spinner className="text-faint" />
      </FullScreen>
    );
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
  return <RouterProvider router={router} />;
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
