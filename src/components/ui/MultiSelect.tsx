import React, { useState, useRef, useEffect } from 'react';
import styles from './MultiSelect.module.scss';

interface MultiSelectProps {
  label?: string;
  options: string[];
  value: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select options...',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options based on search term
  const filteredOptions = options.filter(option =>
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggle = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter(v => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const handleSelectAll = () => {
    onChange([...options]);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  // Handle manual input (press Enter to add)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      e.preventDefault();
      const newModel = searchTerm.trim();
      if (!value.includes(newModel)) {
        onChange([...value, newModel]);
      }
      setSearchTerm('');
    }
  };

  const displayText = value.length === 0
    ? placeholder
    : value.length === 1
    ? value[0]
    : `${value[0]}, ${value[1]}${value.length > 2 ? `, +${value.length - 2}` : ''}`;

  return (
    <div className={styles.container} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}

      <div
        className={`${styles.trigger} ${isOpen ? styles.open : ''} ${disabled ? styles.disabled : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className={value.length === 0 ? styles.placeholder : ''}>
          {displayText}
        </span>
        <span className={styles.arrow}>▼</span>
      </div>

      {isOpen && !disabled && (
        <div className={styles.dropdown}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder={options.length > 0 ? "Search or type model name..." : "Type model name and press Enter..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              className={styles.searchInput}
              autoFocus
            />
          </div>

          <div className={styles.optionsList}>
            {filteredOptions.length === 0 ? (
              <div className={styles.noResults}>
                {options.length === 0
                  ? searchTerm
                    ? 'Press Enter to add this model'
                    : 'Type model name and press Enter to add'
                  : 'No models found'}
              </div>
            ) : (
              filteredOptions.map(option => (
                <div
                  key={option}
                  className={styles.option}
                  onClick={() => handleToggle(option)}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(option)}
                    onChange={() => {}}
                    className={styles.checkbox}
                  />
                  <span className={styles.optionLabel}>{option}</span>
                </div>
              ))
            )}
          </div>

          {options.length > 0 && (
            <div className={styles.actions}>
              <button
                type="button"
                onClick={handleSelectAll}
                className={styles.actionButton}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className={styles.actionButton}
              >
                Clear All
              </button>
            </div>
          )}
        </div>
      )}

      {value.length > 0 && (
        <div className={styles.selectedCount}>
          {value.length} selected
        </div>
      )}
    </div>
  );
};
