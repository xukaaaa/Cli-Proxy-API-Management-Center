import React, { useState, useRef, useEffect } from 'react';
import styles from './SearchableSelect.module.scss';

interface SearchableSelectProps {
  label?: string;
  options: string[];
  value: string;
  onChange: (selected: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowCustomValue?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  disabled = false,
  allowCustomValue = false
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

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setSearchTerm('');
  };

  // Handle manual input (press Enter to add custom value)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      e.preventDefault();
      handleSelect(searchTerm.trim());
    }
  };

  const displayText = value || placeholder;

  return (
    <div className={styles.container} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}

      <div
        className={`${styles.trigger} ${isOpen ? styles.open : ''} ${disabled ? styles.disabled : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className={value ? '' : styles.placeholder}>
          {displayText}
        </span>
        <span className={styles.arrow}>▼</span>
      </div>

      {isOpen && !disabled && (
        <div className={styles.dropdown}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder={allowCustomValue ? "Search or type and press Enter..." : "Search..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={allowCustomValue ? handleKeyDown : undefined}
              className={styles.searchInput}
              autoFocus
            />
          </div>

          <div className={styles.optionsList}>
            {filteredOptions.length === 0 ? (
              <div className={styles.noResults}>
                {options.length === 0 && allowCustomValue && searchTerm
                  ? 'Press Enter to use this value'
                  : options.length === 0 && allowCustomValue
                    ? 'Type and press Enter to add'
                    : 'No results found'
                }
              </div>
            ) : (
              filteredOptions.map(option => (
                <div
                  key={option}
                  className={`${styles.option} ${value === option ? styles.selected : ''}`}
                  onClick={() => handleSelect(option)}
                >
                  <span className={styles.optionLabel}>{option}</span>
                  {value === option && <span className={styles.checkmark}>✓</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
