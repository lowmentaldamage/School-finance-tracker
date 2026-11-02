import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { TransactionForm, type TransactionDraft } from './TransactionForm';

interface QuickAddApi {
  open: (draft?: TransactionDraft) => void;
}

const Ctx = createContext<QuickAddApi>({ open: () => {} });

export function useQuickAdd() {
  return useContext(Ctx);
}

/** App-wide "new transaction" dialog, opened from the sidebar, the mobile + button, or the N key. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft | undefined>();

  const open = useCallback((d?: TransactionDraft) => {
    setDraft(d);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      open();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const api = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <TransactionForm open={isOpen} onOpenChange={setOpen} {...(draft ? { draft } : {})} />
    </Ctx.Provider>
  );
}
