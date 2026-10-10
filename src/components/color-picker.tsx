'use client';

import { useState } from 'react';
import { Popover } from 'radix-ui';
import { HexColorPicker } from 'react-colorful';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import '@/styles/color-picker.css';

type ColorPickerProps = {
  id: string;
  label: string;
  value: string;
  onValueChange: (color: string) => void;
  disabled?: boolean;
  describedBy?: string;
  swatches?: readonly string[];
};

export function ColorPicker({
  id,
  label,
  value,
  onValueChange,
  disabled = false,
  describedBy,
  swatches = [],
}: ColorPickerProps) {
  const t = useTranslations('settings');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ base: value, text: value });
  const text = draft.base === value ? draft.text : value;
  const valid = /^#[0-9a-f]{6}$/i.test(text);
  const errorId = `${id}-error`;
  const description = [describedBy, !valid ? errorId : undefined].filter(Boolean).join(' ');

  function change(color: string) {
    const next = color.toLowerCase();
    setDraft({ base: next, text: next });
    onValueChange(next);
  }

  return (
    <div className="color-control">
      <div className="colour-field color-control-row">
        <Popover.Root open={open && !disabled} onOpenChange={setOpen} modal={false}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="color-picker-trigger"
              disabled={disabled}
              aria-label={t('colorPicker', { label })}
              aria-describedby={describedBy}
              style={{ backgroundColor: value }}
            />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="color-picker-popup"
              data-material="floating"
              aria-label={t('colorPicker', { label })}
              sideOffset={8}
              collisionPadding={12}
              align="start"
            >
              <HexColorPicker color={value} onChange={change} role="group" aria-label={label} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Input
          id={id}
          className="color-hex-input"
          value={text}
          disabled={disabled}
          aria-label={t('colorHex', { label })}
          aria-invalid={!valid}
          aria-describedby={description || undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={7}
          pattern="#[0-9a-fA-F]{6}"
          onChange={(event) => {
            const color = event.target.value;
            setDraft({ base: value, text: color });
            if (/^#[0-9a-f]{6}$/i.test(color)) onValueChange(color.toLowerCase());
          }}
          onBlur={() => setDraft({ base: value, text: value })}
        />
        {swatches.length > 0 && (
          <div className="swatches">
            {swatches.map((color) => (
              <button
                key={color}
                type="button"
                style={{ backgroundColor: color }}
                aria-label={color.toUpperCase()}
                aria-pressed={value.toLowerCase() === color.toLowerCase()}
                disabled={disabled}
                onClick={() => change(color)}
              />
            ))}
          </div>
        )}
      </div>
      {!valid && (
        <p className="color-input-error" id={errorId} role="status">
          {t('invalidColor')}
        </p>
      )}
    </div>
  );
}
