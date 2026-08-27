import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentType } from 'react';

export interface MenubarMenuItem {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
  items?: MenubarMenuItem[];
  divider?: boolean;
}

interface PanelProps {
  items: MenubarMenuItem[];
  style: { left: number; top: number };
  onRequestClose: () => void;
}

function MenuPanel({ items, style, onRequestClose }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<{ index: number; pos: { left: number; top: number } } | null>(null);

  return createPortal(
    <div className="menubar-dropdown__panel" ref={panelRef} style={style}>
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`divider-${i}`} className="menubar-dropdown__divider" />;
        }
        if (item.items) {
          return (
            <div
              key={item.label}
              className="menubar-dropdown__submenu-row"
              onMouseEnter={(e) => {
                if (item.disabled) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setOpenSubmenu({ index: i, pos: { left: rect.right, top: rect.top } });
              }}
            >
              <button disabled={item.disabled}>
                <span className="menubar-dropdown__label">
                  {item.icon && <item.icon size={16} />}
                  <span>{item.label}</span>
                </span>
                <span className="menubar-dropdown__arrow">▸</span>
              </button>
              {openSubmenu?.index === i && (
                <MenuPanel items={item.items} style={openSubmenu.pos} onRequestClose={onRequestClose} />
              )}
            </div>
          );
        }
        return (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onRequestClose();
            }}
          >
            <span className="menubar-dropdown__label">
              {item.icon && <item.icon size={16} />}
              <span>{item.label}</span>
            </span>
            {item.shortcut && <span className="menubar-dropdown__shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

interface Props {
  label: string;
  items: MenubarMenuItem[];
}

export function MenubarMenu({ label, items }: Props) {
  const [isOpen, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    if (isOpen) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ left: rect.left, top: rect.bottom });
    setOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div className="menubar-dropdown">
      <button
        ref={buttonRef}
        className="editor__menubar-item"
        onClick={toggleOpen}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {label}
      </button>
      {isOpen &&
        menuPos &&
        createPortal(
          <div
            ref={backdropRef}
            className="menubar-dropdown__backdrop"
            onClick={() => setOpen(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
          />,
          document.body,
        )}
      {isOpen && menuPos && <MenuPanel items={items} style={menuPos} onRequestClose={() => setOpen(false)} />}
    </div>
  );
}
