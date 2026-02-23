import { Fragment } from 'react';
import { Button } from './Button';
import { IconX } from './icons';
import { SearchableSelect } from './SearchableSelect';
import type { ModelAlias } from '@/types';

interface ModelEntry {
  name: string;
  alias: string;
  thinkingBudget?: string;
}

interface ModelInputListProps {
  entries: ModelEntry[];
  onChange: (entries: ModelEntry[]) => void;
  addLabel?: string;
  disabled?: boolean;
  namePlaceholder?: string;
  aliasPlaceholder?: string;
  hideAddButton?: boolean;
  onAdd?: () => void;
  className?: string;
  rowClassName?: string;
  inputClassName?: string;
  removeButtonClassName?: string;
  removeButtonTitle?: string;
  removeButtonAriaLabel?: string;
  aliasInputMode?: 'text' | 'select';
  aliasOptions?: string[];
  aliasEmptyOptionLabel?: string;
  showThinkingBudgetSelect?: boolean;
  thinkingBudgetOptions?: string[];
  thinkingBudgetPlaceholder?: string;
}

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
  if (!Array.isArray(models) || models.length === 0) {
    return [{ name: '', alias: '', thinkingBudget: '' }];
  }
  return models.map((m) => ({
    name: m.name || '',
    alias: m.alias || '',
    thinkingBudget: m.thinkingBudget || ''
  }));
};

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
  return entries
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const model: ModelAlias = { name: entry.name.trim() };
      const alias = entry.alias.trim();
      if (alias && alias !== model.name) {
        model.alias = alias;
      }
      const thinkingBudget = entry.thinkingBudget?.trim();
      if (thinkingBudget) {
        model.thinkingBudget = thinkingBudget;
      }
      return model;
    });
};

export { type ModelEntry };

export function ModelInputList({
  entries,
  onChange,
  addLabel,
  disabled = false,
  namePlaceholder = 'model-name',
  aliasPlaceholder = 'alias (optional)',
  hideAddButton = false,
  onAdd,
  className = '',
  rowClassName = '',
  inputClassName = '',
  removeButtonClassName = '',
  removeButtonTitle = 'Remove',
  removeButtonAriaLabel = 'Remove',
  aliasInputMode = 'text',
  aliasOptions = [],
  aliasEmptyOptionLabel,
  showThinkingBudgetSelect = false,
  thinkingBudgetOptions = ['minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'none', '512', '1024', '8192', '24576', '32768'],
  thinkingBudgetPlaceholder = 'thinking'
}: ModelInputListProps) {
  const currentEntries = entries.length ? entries : [{ name: '', alias: '', thinkingBudget: '' }];
  const containerClassName = ['header-input-list', className].filter(Boolean).join(' ');
  const inputClassNames = ['input', inputClassName].filter(Boolean).join(' ');
  const rowClassNames = ['header-input-row', rowClassName].filter(Boolean).join(' ');

  const updateEntry = (index: number, field: 'name' | 'alias' | 'thinkingBudget', value: string) => {
    const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry));
    onChange(next);
  };

  const addEntry = () => {
    if (onAdd) {
      onAdd();
    } else {
      onChange([...currentEntries, { name: '', alias: '', thinkingBudget: '' }]);
    }
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [{ name: '', alias: '', thinkingBudget: '' }]);
  };

  return (
    <div className={containerClassName}>
      {currentEntries.map((entry, index) => (
        <Fragment key={index}>
          <div className={`${rowClassNames} ${showThinkingBudgetSelect ? 'header-input-row--with-thinking' : ''}`}>
            <input
              className={inputClassNames}
              placeholder={namePlaceholder}
              value={entry.name}
              onChange={(e) => updateEntry(index, 'name', e.target.value)}
              disabled={disabled}
            />
            <span className="header-separator">→</span>
            {aliasInputMode === 'select' ? (
              <SearchableSelect
                value={entry.alias}
                onChange={(value) => updateEntry(index, 'alias', value)}
                options={entry.alias && !aliasOptions.includes(entry.alias)
                  ? [...aliasOptions, entry.alias]
                  : aliasOptions
                }
                placeholder={aliasEmptyOptionLabel ?? aliasPlaceholder}
                disabled={disabled}
                allowCustomValue
              />
            ) : (
              <input
                className={inputClassNames}
                placeholder={aliasPlaceholder}
                value={entry.alias}
                onChange={(e) => updateEntry(index, 'alias', e.target.value)}
                disabled={disabled}
              />
            )}
            {showThinkingBudgetSelect ? (
              <SearchableSelect
                value={entry.thinkingBudget ?? ''}
                onChange={(value) => updateEntry(index, 'thinkingBudget', value)}
                options={(entry.thinkingBudget && !thinkingBudgetOptions.includes(entry.thinkingBudget)
                  ? [...thinkingBudgetOptions, entry.thinkingBudget]
                  : thinkingBudgetOptions
                ).filter(Boolean)}
                placeholder={thinkingBudgetPlaceholder}
                disabled={disabled}
                allowCustomValue
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeEntry(index)}
              disabled={disabled || currentEntries.length <= 1}
              className={removeButtonClassName}
              title={removeButtonTitle}
              aria-label={removeButtonAriaLabel}
            >
              <IconX size={14} />
            </Button>
          </div>
        </Fragment>
      ))}
      {!hideAddButton && addLabel && (
        <Button variant="secondary" size="sm" onClick={addEntry} disabled={disabled} className="align-start">
          {addLabel}
        </Button>
      )}
    </div>
  );
}
