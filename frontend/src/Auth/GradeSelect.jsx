import { useEffect, useRef, useState } from 'react';
import styles from './GradeSelect.module.css';

const options = [
    { value: 'IGCSE', label: 'IGCSE' },
    { value: 'A-levels', label: 'A-levels' }
];

function GradeSelect({ value, onChange }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const selectedOption = options.find((option) => option.value === value);

    const handleSelect = (selectedValue) => {
        onChange(selectedValue);
        setIsOpen(false);
    };

    return (
        <div className={styles.Select} ref={containerRef}>
            <button
                type="button"
                className={`${styles.Trigger} ${isOpen ? styles.TriggerOpen : ''}`}
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span>{selectedOption?.label || 'Select your grade'}</span>
                <span className={styles.Chevron} aria-hidden="true">▾</span>
            </button>

            {isOpen && (
                <div className={styles.Menu} role="listbox" aria-label="Grade options">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            className={`${styles.Option} ${option.value === value ? styles.OptionActive : ''}`}
                            onClick={() => handleSelect(option.value)}
                            onMouseEnter={() => onChange(option.value)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default GradeSelect;
