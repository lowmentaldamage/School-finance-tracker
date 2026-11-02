import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'negative';
}

const Ctx = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'neutral') => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-md border px-3.5 py-2.5 text-sm shadow-md',
              t.tone === 'negative' ? 'border-negative/30 bg-negative-soft text-negative' : 'border-border bg-text text-bg',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
