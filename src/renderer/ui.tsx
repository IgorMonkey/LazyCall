import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export type IconName = "mic" | "screen" | "chevron" | "refresh" | "play" | "pause" | "stop" | "download" | "down" | "warning" | "check" | "close" | "settings" | "send" | "folder" | "history" | "plus" | "file" | "more" | "help";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16v.1" /></>,
    send: <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" />,
    folder: <path d="M3 4h7l2 3h9v13H3V4Z" />,
    history: <><path d="M3 5v5h5M3.8 9a9 9 0 1 1 .8 8M12 7v5l3 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    file: <><path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8M8 16h6" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6a8 8 0 0 1 13.2 3M4.7 15A8 8 0 0 0 18 18" /></>,
    play: <path d="m9 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>,
    down: <path d="M12 4v16m-6-6 6 6 6-6" />,
    warning: <><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: <><path d="m9 3-.7 2.3-2.1 1.2-2.3-.5-3 5.2 1.7 1.8v2.4L.9 17.2l3 5.2 2.3-.5 2.1 1.2.7 2.3h6l.7-2.3 2.1-1.2 2.3.5 3-5.2-1.7-1.8V13l1.7-1.8-3-5.2-2.3.5-2.1-1.2L15 3H9Z" transform="translate(2 0) scale(.83)" /><circle cx="12" cy="12" r="3" /></>
  };
  return <svg className={"icon icon-" + name} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "stop" | "text";
  size?: "normal" | "compact";
  icon?: IconName;
  loading?: boolean;
};
export function Button({ variant = "secondary", size = "normal", icon, loading = false, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`button button-${variant} button-${size} ${className}`}>
    {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}{children}
  </button>;
}
type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  "aria-label": string;
  size?: "normal" | "small";
  loading?: boolean;
};
export function IconButton({ icon, size = "normal", loading = false, disabled, className = "", type = "button", ...props }: IconButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`icon-button icon-button-${size} ${className}`}>
    {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name={icon} />}
  </button>;
}
type SelectOption = { value: string; label: string; disabled: boolean };

function optionText(nodes: ReactNode): string {
  let text = "";
  Children.forEach(nodes, node => {
    if (typeof node === "string" || typeof node === "number") text += node;
    else if (isValidElement(node)) text += optionText((node.props as { children?: ReactNode }).children);
  });
  return text;
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  const visit = (nodes: ReactNode, inheritedDisabled = false) => Children.forEach(nodes, child => {
    if (!isValidElement(child)) return;
    const props = child.props as { children?: ReactNode; disabled?: boolean; value?: unknown };
    if (child.type === "optgroup") {
      visit(props.children, inheritedDisabled || Boolean(props.disabled));
      return;
    }
    if (child.type === "option") {
      options.push({
        value: String(props.value ?? ""),
        label: optionText(props.children) || String(props.value ?? ""),
        disabled: inheritedDisabled || Boolean(props.disabled)
      });
    }
  });
  visit(children);
  return options;
}

/** A select-shaped control without the platform popup, preserving select's value/onChange API. */
export function Select({ className = "", children, disabled = false, value, defaultValue, onChange, id, title, autoFocus, tabIndex, "aria-label": ariaLabel, "aria-describedby": ariaDescribedBy }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFromChildren(children);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const selectedValue = String(controlled ? value : internalValue);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === selectedValue));
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ value: "", timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const enabledIndex = (from: number, direction: 1 | -1) => {
    for (let step = 1; step <= options.length; step += 1) {
      const index = (from + direction * step + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return from;
  };
  const firstEnabled = () => options.findIndex(option => !option.disabled);
  const lastEnabled = () => {
    for (let index = options.length - 1; index >= 0; index -= 1) if (!options[index].disabled) return index;
    return selectedIndex;
  };
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus());
  };
  const choose = (index: number, returnFocus = true) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!controlled) setInternalValue(option.value);
    onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    close(returnFocus);
  };
  const show = (index = selectedIndex) => {
    if (disabled || !options.length) return;
    setActiveIndex(options[index]?.disabled ? firstEnabled() : index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const clickOutside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!trigger.current?.contains(node) && !popup.current?.contains(node)) close();
    };
    const reposition = () => positionPopup();
    document.addEventListener("pointerdown", clickOutside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", clickOutside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  });
  const positionPopup = () => {
    const button = trigger.current;
    const menu = popup.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const gap = 4;
    const desired = Math.max(160, rect.width);
    const width = Math.min(desired, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const placeAbove = below < 180 && above > below;
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.maxHeight = `${Math.max(80, Math.min(280, (placeAbove ? above : below) - gap))}px`;
    menu.style.top = placeAbove ? "auto" : `${rect.bottom + gap}px`;
    menu.style.bottom = placeAbove ? `${window.innerHeight - rect.top + gap}px` : "auto";
  };
  useLayoutEffect(() => {
    const menu = popup.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!menu) return;
    if (open) {
      positionPopup();
      if (!menu.matches(":popover-open")) menu.showPopover?.();
    } else if (menu.matches(":popover-open")) menu.hidePopover?.();
  }, [open]);
  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.ctrlKey || event.metaKey) return;
    const current = open ? activeIndex : selectedIndex;
    if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(); return; }
    if (event.altKey) return;
    if (event.key === "ArrowDown") { event.preventDefault(); show(open ? enabledIndex(current, 1) : enabledIndex(current, 1)); if (open) setActiveIndex(enabledIndex(current, 1)); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); show(open ? enabledIndex(current, -1) : enabledIndex(current, -1)); if (open) setActiveIndex(enabledIndex(current, -1)); return; }
    if (event.key === "Home") { event.preventDefault(); show(firstEnabled()); if (open) setActiveIndex(firstEnabled()); return; }
    if (event.key === "End") { event.preventDefault(); show(lastEnabled()); if (open) setActiveIndex(lastEnabled()); return; }
    if (event.key === "Escape" && open) { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") { if (open) choose(activeIndex, false); else close(); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(activeIndex); else show(); return; }
    if (event.key.length === 1) {
      const nextText = `${typeahead.current.value}${event.key}`.toLocaleLowerCase();
      typeahead.current.value = nextText;
      clearTimeout(typeahead.current.timer);
      typeahead.current.timer = setTimeout(() => { typeahead.current.value = ""; }, 500);
      const match = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(nextText));
      if (match >= 0) { event.preventDefault(); show(match); if (open) setActiveIndex(match); }
    }
  };

  return <div className={`select-wrap ${className}`}>
    <button id={id} ref={trigger} type="button" title={title} autoFocus={autoFocus} tabIndex={tabIndex} disabled={disabled} className="ui-select" role="combobox" aria-label={ariaLabel} aria-describedby={ariaDescribedBy} aria-controls={listboxId} aria-expanded={open} aria-activedescendant={open ? optionId(activeIndex) : undefined} onClick={() => open ? close() : show()} onKeyDown={onKeyDown}>
      <span className="ui-select-value" title={selected?.label}>{selected?.label}</span><Icon name="chevron" />
    </button>
    <div ref={popup} className="ui-select-popover" popover="manual" id={listboxId} role="listbox" aria-label={ariaLabel} onToggle={event => { if (event.newState === "closed") setOpen(false); }}>
      {options.map((option, index) => <button key={`${option.value}-${index}`} id={optionId(index)} type="button" role="option" tabIndex={-1} aria-selected={index === selectedIndex} disabled={option.disabled} className={`ui-select-option${index === activeIndex ? " is-active" : ""}`} onMouseDown={event => event.preventDefault()} onMouseMove={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(index)}>{option.label}{index === selectedIndex && <Icon name="check" />}</button>)}
    </div>
  </div>;
}
export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={"ui-textarea " + className} />;
}
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={"ui-input " + className} />;
}
export function Checkbox({ children, ...props }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return <label className="ui-checkbox"><input {...props} type="checkbox" /><span>{children}</span></label>;
}
export function Field({ id, label, icon, layout = "stacked", children }: { id: string; label: string; icon?: IconName; layout?: "stacked" | "inline"; children: ReactNode }) {
  return <div className={`field field-${layout}`}><label htmlFor={id}>{icon && <Icon name={icon} />}{label}</label>{children}</div>;
}
