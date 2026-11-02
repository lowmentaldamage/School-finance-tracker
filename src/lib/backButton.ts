import { useEffect, useRef } from 'react';

/**
 * Makes the Android back button (and browser back) close the top-most open dialog instead of
 * leaving the page. Each open dialog pushes a history entry; "back" pops it and closes the dialog.
 */
const stack: Array<{ id: number; close: () => void }> = [];
let ignorePops = 0;
let nextId = 1;
let installed = false;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    stack.pop()?.close();
  });
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    install();
    const id = nextId++;
    const entry = { id, close: () => closeRef.current() };
    stack.push(entry);
    window.history.pushState({ ...(window.history.state ?? {}), keelDialog: id }, '');
    return () => {
      const i = stack.indexOf(entry);
      if (i < 0) return; // already closed by the back button
      stack.splice(i, 1);
      // Closed from the UI: remove our history entry, unless a navigation already replaced it.
      if ((window.history.state as { keelDialog?: number } | null)?.keelDialog === id) {
        ignorePops++;
        window.history.back();
      }
    };
  }, [open]);
}
