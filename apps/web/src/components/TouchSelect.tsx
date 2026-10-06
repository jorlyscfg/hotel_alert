import { useEffect, useId, useRef, useState, type InvalidEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n';

export interface TouchSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

type OptionNavigation = 'next' | 'previous' | 'first' | 'last';

interface TouchSelectProps {
  label: string;
  value: string;
  options: TouchSelectOption[];
  onChange: (value: string) => void;
  selectedLabel?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  modal?: boolean;
  id?: string;
  error?: string;
}

export function getNextOptionIndex(currentIndex: number, optionCount: number, navigation: OptionNavigation): number {
  if (optionCount === 0) return -1;
  if (navigation === 'first') return 0;
  if (navigation === 'last') return optionCount - 1;
  if (navigation === 'next') return (currentIndex + 1 + optionCount) % optionCount;
  return currentIndex < 0 ? optionCount - 1 : (currentIndex - 1 + optionCount) % optionCount;
}

export function hasSelectableValue(value: string, options: TouchSelectOption[]): boolean {
  return options.some((option) => option.value === value);
}

export function getTouchSelectClassName(modal: boolean, open: boolean, className?: string): string {
  return `form-field touch-select${modal ? ' touch-select--modal' : ''}${open ? ' touch-select--open' : ''}${className === undefined ? '' : ` ${className}`}`;
}

export function TouchSelect({ label, value, options, onChange, selectedLabel, className, placeholder, required = false, disabled = false, modal = false, id, error }: TouchSelectProps) {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder ?? t('common.select', { label: label.toLowerCase() });
  const generatedId = useId().replaceAll(':', '');
  const triggerId = id ?? `touch-select-${generatedId}`;
  const labelId = `${triggerId}-label`;
  const listboxId = `${triggerId}-listbox`;
  const errorId = `${triggerId}-error`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const activeError = error ?? validationError;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      const isInsideRoot = event.target instanceof Node && rootRef.current?.contains(event.target) === true;
      if (isInsideRoot) return;
      if (modal) {
        // Keep the modal layer mounted until the matching click can be consumed.
        event.stopPropagation();
        return;
      }
      setOpen(false);
    };
    const handleClick = (event: MouseEvent): void => {
      if (!modal) return;
      const isInsideRoot = event.target instanceof Node && rootRef.current?.contains(event.target) === true;
      if (isInsideRoot) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, modal);
    document.addEventListener('click', handleClick, modal);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, modal);
      document.removeEventListener('click', handleClick, modal);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal, open]);

  useEffect(() => {
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  function selectOption(option: TouchSelectOption): void {
    onChange(option.value);
    setValidationError(undefined);
    setOpen(false);
  }

  function handleValidationInvalid(event: InvalidEvent<HTMLInputElement>): void {
    event.preventDefault();
    setValidationError(t('errors.requiredSelection', { label: label.toLowerCase() }));
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return;
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      } else if (options[activeIndex] !== undefined) {
        selectOption(options[activeIndex]);
      }
      return;
    }
    const navigation = event.key === 'ArrowDown' ? 'next' : event.key === 'ArrowUp' ? 'previous' : event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : null;
    if (navigation === null) return;
    event.preventDefault();
    setOpen(true);
    const navigationIndex = open ? activeIndex : selectedIndex;
    setActiveIndex(getNextOptionIndex(navigationIndex, options.length, navigation));
  }

  function handleOptionPointerDown(event: ReactPointerEvent<HTMLDivElement>, option: TouchSelectOption): void {
    if (modal) return;
    event.preventDefault();
    selectOption(option);
  }

  function handleModalOptionClick(event: ReactMouseEvent<HTMLDivElement>, option: TouchSelectOption): void {
    if (!modal) return;
    event.preventDefault();
    event.stopPropagation();
    selectOption(option);
  }

  function handleModalBackdropClick(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }

  return (
     <div className={getTouchSelectClassName(modal, open, className)} data-modal-interaction-blocker={modal ? 'true' : undefined} ref={rootRef}>
       <label id={labelId} htmlFor={triggerId}>{label}</label>
      <button
        id={triggerId}
        ref={triggerRef}
        className="touch-select__trigger"
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && options[activeIndex] !== undefined ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-required={required}
        aria-invalid={activeError !== undefined}
        aria-describedby={activeError === undefined ? undefined : errorId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        {selectedOption === undefined ? <span className="touch-select__placeholder">{resolvedPlaceholder}</span> : <span className="touch-select__value">{selectedOption.icon !== undefined && <span className="touch-select__option-icon" aria-hidden="true">{selectedOption.icon}</span>}<span>{selectedLabel ?? selectedOption.label}</span></span>}
        <span className="touch-select__chevron" aria-hidden="true"><ChevronDown size={18} strokeWidth={1.8} /></span>
       </button>
        {open && modal && <div className="touch-select__backdrop" aria-hidden="true" onClick={handleModalBackdropClick} />}
       {open && (
        <div className="touch-select__menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
          {options.length === 0 ? <div className="touch-select__empty">{resolvedPlaceholder}</div> : options.map((option, index) => (
            <div
              className={`touch-select__option${index === activeIndex ? ' touch-select__option--active' : ''}`}
              id={`${listboxId}-option-${index}`}
              key={option.value}
              role="option"
              tabIndex={-1}
              aria-posinset={index + 1}
              aria-setsize={options.length}
              aria-selected={option.value === value}
              onPointerDown={(event) => handleOptionPointerDown(event, option)}
              onClick={(event) => handleModalOptionClick(event, option)}
            >
              <span className="touch-select__value">{option.icon !== undefined && <span className="touch-select__option-icon" aria-hidden="true">{option.icon}</span>}<span>{option.label}</span></span>
               {option.value === value && <Check className="touch-select__check" aria-hidden="true" size={16} strokeWidth={2} />}
            </div>
          ))}
        </div>
       )}
       {required && <input className="touch-select__validation" tabIndex={-1} aria-hidden={activeError === undefined} aria-label={label} value={hasSelectableValue(value, options) ? value : ''} onChange={() => undefined} required onInvalid={handleValidationInvalid} />}
       {activeError !== undefined && <p className="form-error" id={errorId} role="alert">{activeError}</p>}
    </div>
  );
}
