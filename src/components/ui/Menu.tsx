import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-[168px] rounded-md border border-border bg-surface p-1 shadow-md"
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, danger }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-default select-none items-center rounded-sm px-2 text-[13px] outline-none',
        'data-[highlighted]:bg-surface-2',
        danger ? 'text-negative' : 'text-text',
      )}
    >
      {children}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}
