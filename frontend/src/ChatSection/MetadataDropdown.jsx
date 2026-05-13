import styles from './ChatSection.module.css';

function MetadataDropdown({
    id,
    label,
    value,
    options,
    direction = 'down',
    isOpen,
    onOpen,
    onClose,
    onToggle,
    onSelect
}) {
    const selectedOption = options.find(option => option.value === value);
    const displayLabel = selectedOption ? selectedOption.label : `${label} (None)`;

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(id);
        }

        if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div
            className={`${styles.Dropdown} ${direction === 'up' ? styles.DropdownUp : styles.DropdownDown}`}
            onMouseEnter={() => onOpen(id)}
            onMouseLeave={onClose}
        >
            <button
                type="button"
                className={`${styles.SelectBtn} ${isOpen ? styles.SelectBtnOpen : ''}`}
                onClick={() => onToggle(id)}
                onFocus={() => onOpen(id)}
                onKeyDown={handleKeyDown}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className={styles.SelectLabel}>{displayLabel}</span>
            </button>

            {isOpen && (
                <div className={styles.DropdownMenuWrapper}>
                    <div className={styles.DropdownMenu} role="listbox" aria-label={label}>
                        {options.map((option) => (
                            <button
                                key={option.value || `${id}-${option.label}`}
                                type="button"
                                className={`${styles.DropdownOption} ${option.value === value ? styles.DropdownOptionActive : ''}`}
                                onClick={() => onSelect(option.value)}
                                role="option"
                                aria-selected={option.value === value}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default MetadataDropdown;
