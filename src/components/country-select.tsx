'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CountryFlag } from '@/components/country-flag';
import { countryCode, countryOptions, matchesCountry } from '@/lib/countries';
import { cn } from '@/lib/utils';
import './country-select.css';

type CountrySelectProps = {
  value: string;
  onValueChange: (code: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  allowAll?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

// The nonmodal popover, shadcn fields and listbox share one search focus.
// Opening this control leaves the page scrollbar and its width untouched.
export function CountrySelect({
  value,
  onValueChange,
  id,
  name,
  disabled,
  allowAll = false,
  className,
  ...aria
}: CountrySelectProps) {
  const locale = useLocale();
  const t = useTranslations('countries');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = countryCode(value);
  const choices = useMemo(() => countryOptions(locale), [locale]);
  const options = [
    ...(allowAll ? [{ code: '', name: t('all'), search: `${t('all')} all countries` }] : []),
    ...(!choices.some((choice) => choice.code === selected) && /^[A-Z]{2}$/.test(selected)
      ? [{ code: selected, name: selected, search: selected.toLowerCase() }]
      : []),
    ...choices,
  ].filter((choice) => matchesCountry(choice.search, query));
  const active = options.find((choice) => choice.code === activeCode) ?? options[0];
  const visibleActiveCode = active?.code;
  const optionId = (code: string) => `${listId}-${code || 'all'}`;

  useEffect(() => {
    if (!open || visibleActiveCode === undefined) return;
    const option = document.getElementById(`${listId}-${visibleActiveCode || 'all'}`);
    if (option && listRef.current?.contains(option)) option.scrollIntoView({ block: 'nearest' });
  }, [open, visibleActiveCode, listId]);

  function select(code: string) {
    onValueChange(code);
    setOpen(false);
  }
  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') {
      // Radix loops its content focus scope even in a nonmodal popover. Dismiss
      // this one-field scope instead of trapping Tab in the search field.
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (active) select(active.code);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !options.length) return;
    event.preventDefault();
    const index = options.findIndex((choice) => choice.code === active?.code);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    setActiveCode(options[next].code);
  }

  return (
    <Popover.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          setActiveCode(selected);
        }
      }}
    >
      {name && <input type="hidden" name={name} value={selected} disabled={disabled} />}
      <Popover.Trigger asChild>
        <Button
          {...aria}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          data-value={selected}
          className={cn('country-select-trigger', className)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setQuery('');
              setActiveCode(selected);
              setOpen(true);
            }
          }}
        >
          {selected ? (
            <CountryFlag country={selected} display="name" />
          ) : (
            <span>{allowAll ? t('all') : t('choose')}</span>
          )}
          <ChevronsUpDown className="size-3.5" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-slot="popover-content"
          data-material="floating"
          className="country-select-menu"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="country-select-search">
            <Search className="size-4" aria-hidden="true" />
            <Input
              ref={searchRef}
              role="combobox"
              aria-label={t('search')}
              placeholder={t('search')}
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(active.code) : undefined}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveCode(null);
              }}
              onKeyDown={handleSearchKey}
            />
          </div>
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={aria['aria-label'] ?? t('choose')}
            className="country-select-options"
          >
            {options.map((choice) => (
              <div
                key={choice.code}
                id={optionId(choice.code)}
                role="option"
                aria-selected={choice.code === selected}
                data-highlighted={choice.code === active?.code ? '' : undefined}
                data-option-value={choice.code}
                className="country-select-option"
                onPointerMove={() => setActiveCode(choice.code)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => select(choice.code)}
              >
                {choice.code ? (
                  <CountryFlag country={choice.code} display="name" />
                ) : (
                  <span>{choice.name}</span>
                )}
                {choice.code === selected && <Check className="size-3.5" aria-hidden="true" />}
              </div>
            ))}
            {!options.length && (
              <p className="country-select-empty" role="status">
                {t('empty')}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
