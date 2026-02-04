import React from 'react';
import styles from './ProgressBar.module.scss';

interface ProgressBarProps {
  current: number;
  limit: number;
  label?: string;
  showPercentage?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  current,
  limit,
  label,
  showPercentage = false
}) => {
  const percentage = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;

  // Color based on percentage
  const getColorClass = () => {
    if (percentage >= 90) return styles.danger;
    if (percentage >= 70) return styles.warning;
    return styles.success;
  };

  return (
    <div className={styles.container}>
      {label && <div className={styles.label}>{label}</div>}
      <div className={styles.bar}>
        <div
          className={`${styles.fill} ${getColorClass()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showPercentage && (
        <div className={styles.percentage}>{percentage.toFixed(1)}%</div>
      )}
    </div>
  );
};
