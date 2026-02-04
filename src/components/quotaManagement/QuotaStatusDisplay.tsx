import React from 'react';
import type { QuotaPolicy, QuotaUsage } from '@/types/quotaManagement';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  formatCurrency,
  formatTokens,
  isPolicyExpired
} from '@/utils/quotaManagement';
import styles from './QuotaStatusDisplay.module.scss';

interface QuotaStatusDisplayProps {
  apiKey: string;
  policy?: QuotaPolicy;
  usage?: QuotaUsage;
  onEditPolicy: () => void;
  onDeletePolicy: () => void;
  onAddPolicy: () => void;
}

export const QuotaStatusDisplay: React.FC<QuotaStatusDisplayProps> = ({
  policy,
  usage,
  onEditPolicy,
  onDeletePolicy,
  onAddPolicy
}) => {
  const hasPolicy = !!policy;
  const hasUsage = !!usage;
  const isExpired = isPolicyExpired(policy?.expires_at);

  // Format last used time
  const formatLastUsed = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>Quota Status</h4>
        <div className={styles.actions}>
          {hasPolicy ? (
            <>
              <Button variant="secondary" size="sm" onClick={onEditPolicy}>
                Edit Policy
              </Button>
              <Button variant="danger" size="sm" onClick={onDeletePolicy}>
                Delete
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onAddPolicy}>
              Add Policy
            </Button>
          )}
        </div>
      </div>

      {hasPolicy && (
        <div className={styles.policyInfo}>
          {policy.name && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Policy Name</span>
              <span className={styles.infoValue}>{policy.name}</span>
            </div>
          )}

          {policy.allowed_models && policy.allowed_models.length > 0 && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Allowed Models</span>
              <span className={styles.infoValue}>
                {policy.allowed_models.length} model{policy.allowed_models.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {policy.max_tokens && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Max Tokens</span>
              <span className={styles.infoValue}>{formatTokens(policy.max_tokens)}</span>
            </div>
          )}

          {policy.max_cost_usd && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Max Cost</span>
              <span className={styles.infoValue}>{formatCurrency(policy.max_cost_usd)}</span>
            </div>
          )}

          {policy.expires_at && (
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Expires At</span>
              <span className={styles.infoValue}>
                {new Date(policy.expires_at).toLocaleDateString()}
                {isExpired && <span className={styles.expiredBadge}>Expired</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {!hasPolicy && (
        <p className={styles.noPolicyMessage}>No quota policy set for this API key</p>
      )}

      {hasUsage && (
        <div className={styles.usageSection}>
          <h5 className={styles.usageTitle}>Usage Statistics</h5>

          <div className={styles.usageGrid}>
            {/* Token Usage */}
            {policy?.max_tokens && (
              <div className={styles.usageItem}>
                <div className={styles.usageHeader}>
                  <span className={styles.usageLabel}>Token Usage</span>
                  <span className={styles.usageValue}>
                    {formatTokens(usage.total_tokens)} / {formatTokens(policy.max_tokens)}
                  </span>
                </div>
                <ProgressBar
                  current={usage.total_tokens}
                  limit={policy.max_tokens}
                  showPercentage={true}
                />
              </div>
            )}

            {/* Cost Usage */}
            {policy?.max_cost_usd && (
              <div className={styles.usageItem}>
                <div className={styles.usageHeader}>
                  <span className={styles.usageLabel}>Cost Usage</span>
                  <span className={styles.usageValue}>
                    {formatCurrency(usage.total_cost_usd)} / {formatCurrency(policy.max_cost_usd)}
                  </span>
                </div>
                <ProgressBar
                  current={usage.total_cost_usd}
                  limit={policy.max_cost_usd}
                  showPercentage={true}
                />
              </div>
            )}

            {/* Total Requests */}
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Total Requests</span>
              <span className={styles.infoValue}>{usage.total_requests.toLocaleString()}</span>
            </div>

            {/* Last Used */}
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Last Used</span>
              <span className={styles.infoValue}>
                {formatLastUsed(usage.last_used_at)}
              </span>
            </div>
          </div>
        </div>
      )}

      {!hasUsage && hasPolicy && (
        <p className={styles.noUsageMessage}>No usage data yet</p>
      )}
    </div>
  );
};
