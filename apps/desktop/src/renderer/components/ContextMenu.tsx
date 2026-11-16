import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '@basalt/ui';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  run: () => void;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 230);
  const top = Math.min(y, window.innerHeight - items.length * 32 - 16);
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left, top }}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          onClick={() => {
            onClose();
            it.run();
          }}
          onKeyDown={(e) => {
            const btns = [...(ref.current?.querySelectorAll('button') ?? [])];
            const i = btns.indexOf(e.currentTarget);
            if (e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus();
            if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus();
          }}
        >
          {it.icon ? <Icon name={it.icon} size={16} /> : <span className="menu-gap" />}
          {it.label}
        </button>
      ))}
    </div>
  );
}
