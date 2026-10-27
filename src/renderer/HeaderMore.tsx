import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon } from "./ui";
import { useI18n } from "./i18n";

export function HeaderMore({ exportDisabled, onExport, onCompact, onHelp }: {
  exportDisabled: boolean; onExport: () => void; onCompact: () => void; onHelp: () => void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
  const position = () => {
    if (!trigger.current || !menu.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    menu.current.style.width = `${width}px`;
    menu.current.style.left = `${Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12))}px`;
    menu.current.style.top = `${bounds.bottom + 8}px`;
  };
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);
  const close = (restoreFocus = true) => {
    menu.current?.hidePopover(); setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (last = false) => {
    menu.current?.showPopover(); position(); setOpen(true);
    const enabled = items(); (last ? enabled.at(-1) : enabled[0])?.focus();
  };
  const run = (action: () => void) => { close(); action(); };
  return <div className="header-more">
    <button ref={trigger} type="button" className="button button-quiet header-more-trigger" aria-label={t("Ещё")} aria-haspopup="menu" aria-controls={id} aria-expanded={open}
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(event.key === "ArrowUp"); }
      }}><Icon name="more" /><span>{t("Ещё")}</span></button>
    <div ref={menu} id={id} popover="auto" className="header-more-menu" role="menu" aria-label={t("Дополнительные действия")}
      onToggle={event => setOpen(event.newState === "open")} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === "Tab") { close(); return; }
        const enabled = items(), index = enabled.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % enabled.length;
        if (event.key === "ArrowUp") next = (index + enabled.length - 1) % enabled.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = enabled.length - 1;
        if (next !== undefined) { event.preventDefault(); enabled[next]?.focus(); }
      }}>
      <Button variant="quiet" icon="screen" role="menuitem" tabIndex={-1} onClick={() => run(onCompact)}><span>{t("Мини-окно")}</span><kbd>Ctrl+Alt+Space</kbd></Button>
      <Button variant="quiet" icon="download" role="menuitem" tabIndex={-1} disabled={exportDisabled} onClick={() => run(onExport)}>{t("Экспорт")}</Button>
      <div className="header-menu-divider" role="separator" />
      <Button variant="quiet" icon="help" role="menuitem" tabIndex={-1} onClick={() => run(onHelp)}>{t("Как пользоваться")}</Button>
    </div>
  </div>;
}
