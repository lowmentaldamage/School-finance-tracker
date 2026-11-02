import type { SelectHTMLAttributes } from 'react';

import type { Category, CategoryKind } from '../../api/types';
import { Select } from '../../components/ui';

/** Category picker with subcategories listed under their parent. */
export function CategorySelect({
  categories,
  kind,
  emptyLabel,
  keepId,
  ...rest
}: {
  categories: Category[];
  kind: CategoryKind;
  emptyLabel: string;
  /** Keep this (possibly archived) category selectable, e.g. when editing. */
  keepId?: string | null;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const usable = categories.filter((c) => c.kind === kind && (!c.archived || c.id === keepId));
  const tops = usable.filter((c) => c.parent_id === null);
  return (
    <Select {...rest}>
      <option value="">{emptyLabel}</option>
      {tops.map((p) => {
        const kids = usable.filter((c) => c.parent_id === p.id);
        return [
          <option key={p.id} value={p.id}>
            {p.name}
          </option>,
          ...kids.map((c) => (
            <option key={c.id} value={c.id}>
              {' '}
              {c.name}
            </option>
          )),
        ];
      })}
    </Select>
  );
}
