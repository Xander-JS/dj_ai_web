import React, { useCallback, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import '../atoms/SelectField.css';
import './SelectMenu.css';

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  /** Segunda línea (artista, detalle); también se usa al buscar */
  description?: string;
  disabled?: boolean;
}

/** Control imperativo opcional: abrir o cerrar la lista desde fuera (p. ej. un atajo de teclado). */
export interface SelectMenuHandle {
  open(): void;
  /** Abre la lista con el foco en las opciones (no en el buscador) o la cierra si ya está abierta. */
  toggle(): void;
}

export interface SelectMenuProps<T extends string> {
  /** '' muestra el texto de `placeholder` */
  value: T | '';
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  placeholder: string;
  /** Nombre accesible del control */
  label: string;
  /** sm: celdas y barras densas · md: predeterminado (misma escala que SelectField) */
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Campo de búsqueda en la lista; requiere searchPlaceholder y noResultsLabel */
  searchPlaceholder?: string;
  noResultsLabel?: string;
  /** Ancho mínimo de la lista cuando el disparador es más estrecho */
  menuMinWidth?: number;
  autoFocus?: boolean;
  /** Teclas con la lista cerrada (p. ej. Enter para guardar una fila); preventDefault evita abrirla */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  wrapperClassName?: string;
  handleRef?: React.Ref<SelectMenuHandle>;
  /** Se llama cada vez que la lista se abre (p. ej. para refrescar las opciones) */
  onOpen?: () => void;
  /** Al elegir o cerrar con Escape el foco vuelve al disparador (predeterminado). Con false se
      libera, para que los atajos globales sigan activos (consola del Mixer). */
  returnFocus?: boolean;
  /** Tecla pulsada con la lista abierta fuera del buscador; si devuelve true, se consume */
  onMenuKey?: (event: React.KeyboardEvent) => boolean;
  /** Clase extra del panel flotante (va en un portal, fuera del envoltorio) */
  menuClassName?: string;
}

const VIEWPORT_GAP = 8;
const MENU_OFFSET = 6;
const MENU_MAX_HEIGHT = 320;

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Selector desplegable del Design System v2. Sustituye al <select> nativo cuando su lista
 * (que dibuja el sistema operativo) rompe la identidad: papel enmarcado en tinta, como el panel
 * de avisos. Patrón ARIA de combobox con listbox: flechas, Inicio/Fin, RePág/AvPág, Enter,
 * Escape, búsqueda por tecleo. La lista va en un portal y se coloca encima del disparador
 * cuando no cabe debajo, ajustada a los bordes de la ventana.
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  label,
  size = 'md',
  disabled = false,
  searchPlaceholder,
  noResultsLabel,
  menuMinWidth = 0,
  autoFocus,
  onKeyDown,
  wrapperClassName,
  handleRef,
  onOpen,
  returnFocus = true,
  onMenuKey,
  menuClassName,
}: SelectMenuProps<T>) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeaheadRef = useRef({ text: '', timer: 0 });
  // Abierta con toggle(): el foco va a las opciones para que la misma tecla pueda cerrarla
  const focusListRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const searchable = Boolean(searchPlaceholder && noResultsLabel);
  const visible = searchable && query.trim()
    ? options.filter((option) => normalize(`${option.label} ${option.description ?? ''}`).includes(normalize(query.trim())))
    : options;
  const selected = options.find((option) => option.value === value);

  const firstEnabled = (list: SelectMenuOption<T>[], from = 0, step = 1): number => {
    for (let i = from; i >= 0 && i < list.length; i += step) {
      if (!list[i].disabled) return i;
    }
    return -1;
  };

  const openMenu = () => {
    if (disabled || open) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setQuery('');
    setActiveIndex(selectedIndex !== -1 ? selectedIndex : firstEnabled(options));
    setOpen(true);
    onOpen?.();
  };


  const closeMenu = useCallback((restoreFocus: boolean, releaseFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    } else if (releaseFocus && document.activeElement instanceof HTMLElement && (
      menuRef.current?.contains(document.activeElement) || document.activeElement === triggerRef.current
    )) {
      document.activeElement.blur();
    }
  }, []);

  useImperativeHandle(handleRef, () => ({
    open: () => {
      focusListRef.current = false;
      openMenu();
    },
    toggle: () => {
      if (open) {
        closeMenu(returnFocus, !returnFocus);
        return;
      }
      focusListRef.current = true;
      openMenu();
    },
  }));

  const choose = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu(returnFocus, !returnFocus);
  };

  // Posición: se escribe directamente en el estilo de la lista (sin renders por scroll o resize)
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, menuMinWidth), viewportWidth - VIEWPORT_GAP * 2);
      const left = Math.min(Math.max(rect.left, VIEWPORT_GAP), viewportWidth - width - VIEWPORT_GAP);
      const below = viewportHeight - rect.bottom - MENU_OFFSET - VIEWPORT_GAP;
      const above = rect.top - MENU_OFFSET - VIEWPORT_GAP;
      const natural = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
      const placeAbove = below < natural && above > below;
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${Math.max(Math.min(MENU_MAX_HEIGHT, placeAbove ? above : below), 120)}px`;
      if (placeAbove) {
        menu.style.top = '';
        menu.style.bottom = `${viewportHeight - rect.top + MENU_OFFSET}px`;
      } else {
        menu.style.bottom = '';
        menu.style.top = `${rect.bottom + MENU_OFFSET}px`;
      }
      menu.dataset.placement = placeAbove ? 'top' : 'bottom';
    };
    place();
    const handleScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, menuMinWidth, visible.length]);

  // Foco al abrir y cierre al pulsar fuera
  useLayoutEffect(() => {
    if (!open) return;
    (searchable && !focusListRef.current ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    focusListRef.current = false;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open, searchable, closeMenu]);

  // La opción activa siempre queda a la vista dentro de la lista
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  });

  const moveActive = (next: number) => {
    if (next >= 0) setActiveIndex(next);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const inSearch = event.target === searchRef.current;
    if (!inSearch && onMenuKey?.(event)) {
      event.preventDefault();
      return;
    }
    const last = visible.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(firstEnabled(visible, activeIndex + 1) !== -1 ? firstEnabled(visible, activeIndex + 1) : activeIndex);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(firstEnabled(visible, activeIndex - 1, -1) !== -1 ? firstEnabled(visible, activeIndex - 1, -1) : activeIndex);
        break;
      case 'Home':
        event.preventDefault();
        moveActive(firstEnabled(visible));
        break;
      case 'End':
        event.preventDefault();
        moveActive(firstEnabled(visible, last, -1));
        break;
      case 'PageDown':
        event.preventDefault();
        moveActive(firstEnabled(visible, Math.min(last, activeIndex + 8)) !== -1 ? firstEnabled(visible, Math.min(last, activeIndex + 8)) : firstEnabled(visible, last, -1));
        break;
      case 'PageUp':
        event.preventDefault();
        moveActive(firstEnabled(visible, Math.max(0, activeIndex - 8)));
        break;
      case 'Enter':
        event.preventDefault();
        choose(activeIndex);
        break;
      case ' ':
        if (!searchable) {
          event.preventDefault();
          choose(activeIndex);
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeMenu(returnFocus, !returnFocus);
        break;
      case 'Tab':
        // El foco vuelve al disparador y el tabulador sigue desde allí
        closeMenu(true);
        break;
      default:
        // Con el foco en las opciones, escribir empieza la búsqueda (la tecla llega al buscador)
        if (searchable && !inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          searchRef.current?.focus({ preventScroll: true });
          break;
        }
        if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const buffer = typeaheadRef.current;
          window.clearTimeout(buffer.timer);
          buffer.text += normalize(event.key);
          buffer.timer = window.setTimeout(() => { buffer.text = ''; }, 600);
          const match = visible.findIndex((option) => !option.disabled && normalize(option.label).startsWith(buffer.text));
          moveActive(match);
        }
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    // Enter y Espacio abren la lista con el clic nativo del botón; si onKeyDown los consume, no se abre
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu();
    }
  };

  const activeDescendant = open && activeIndex >= 0 && visible[activeIndex] ? optionId(activeIndex) : undefined;

  return (
    <span className={clsx('sd-select-field', `sd-select-field--${size}`, 'sd-select-menu', open && 'is-open', wrapperClassName)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        title={selected?.description ? `${selected.label} — ${selected.description}` : selected?.label}
        className={clsx('sd-select-field__control', 'sd-select-menu__trigger', !selected && 'is-placeholder')}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="sd-select-menu__value">{selected ? selected.label : placeholder}</span>
      </button>
      <Icon icon={ChevronDown} size="sm" className="sd-select-field__chevron sd-select-menu__chevron" />

      {open && createPortal(
        <div ref={menuRef} className={clsx('sd-select-menu__panel', menuClassName)} onKeyDown={handleMenuKeyDown}>
          {searchable && (
            <label className="sd-select-menu__search">
              <Icon icon={Search} size="sm" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={searchPlaceholder}
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  const nextVisible = nextQuery.trim()
                    ? options.filter((option) => normalize(`${option.label} ${option.description ?? ''}`).includes(normalize(nextQuery.trim())))
                    : options;
                  setQuery(nextQuery);
                  setActiveIndex(firstEnabled(nextVisible));
                }}
              />
            </label>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={activeDescendant}
            className="sd-select-menu__list"
          >
            {visible.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  title={option.description ? `${option.label} — ${option.description}` : option.label}
                  className={clsx(
                    'sd-select-menu__option',
                    index === activeIndex && 'is-active',
                    isSelected && 'is-selected',
                    option.disabled && 'is-disabled',
                  )}
                  onPointerMove={() => { if (!option.disabled && index !== activeIndex) setActiveIndex(index); }}
                  onClick={() => choose(index)}
                >
                  <span className="sd-select-menu__text">
                    <span className="sd-select-menu__label">{option.label}</span>
                    {option.description && <span className="sd-select-menu__description">{option.description}</span>}
                  </span>
                  <span className="sd-select-menu__check" aria-hidden="true">
                    {isSelected && <Icon icon={Check} size="sm" />}
                  </span>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li role="presentation" className="sd-select-menu__empty">{noResultsLabel}</li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}
