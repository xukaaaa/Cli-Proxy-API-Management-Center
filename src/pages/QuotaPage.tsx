import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  IconRefreshCw,
  IconTimer,
  IconChartLine,
  IconChevronDown,
  IconChevronUp,
} from '@/components/ui/icons';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { QuotaProvider, QuotaResult, QuotaInfo, QuotaGroup } from '@/types/quota';
import styles from './QuotaPage.module.scss';

// Constants for percentage thresholds
const HIGH_PERCENT_THRESHOLD = 70;
const MEDIUM_PERCENT_THRESHOLD = 30;

// Threshold for showing relative time (in hours)
const RELATIVE_TIME_THRESHOLD_HOURS = 24;

// Provider configuration
const PROVIDER_CONFIG = {
  antigravity: {
    name: 'Antigravity',
    icon: 'A',
    className: 'antigravity',
  },
  kiro: {
    name: 'Kiro',
    icon: 'K',
    className: 'kiro',
  },
} as const;

function getPercentLevel(percent: number): 'high' | 'medium' | 'low' {
  if (percent >= HIGH_PERCENT_THRESHOLD) return 'high';
  if (percent >= MEDIUM_PERCENT_THRESHOLD) return 'medium';
  return 'low';
}

function formatResetTime(isoString?: string, locale?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;

    const now = new Date();
    const diff = date.getTime() - now.getTime();

    // If reset time is in the future and less than threshold, show relative time
    if (diff > 0 && diff < RELATIVE_TIME_THRESHOLD_HOURS * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    }

    // Otherwise show absolute date
    return date.toLocaleString(locale || 'en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function getAvatarLetter(email: string): string {
  if (!email) return '?';
  return email.charAt(0).toUpperCase();
}

interface ResourceRowProps {
  quota: QuotaInfo;
  locale?: string;
}

function ResourceRow({ quota, locale }: ResourceRowProps) {
  const { t } = useTranslation();
  const level = getPercentLevel(quota.remainingPercent);
  const resetTimeStr = formatResetTime(quota.resetTime, locale);
  const expiryTimeStr = formatResetTime(quota.expiryTime, locale);

  // Format usage display
  const getUsageDisplay = () => {
    if (quota.isAbsoluteValue) {
      // Show remaining/limit format (e.g., 50/50 = full, 10/50 = low)
      const remaining = quota.limit - quota.used;
      return `${remaining}/${quota.limit}`;
    }
    return `${quota.remainingPercent.toFixed(0)}%`;
  };

  return (
    <div className={styles.resourceRow}>
      <div className={styles.resourceInfo}>
        <div className={styles.resourceIdentity}>
          <span className={styles.modelName}>{quota.displayName || quota.modelName}</span>
        </div>
        <div className={styles.resourceMetrics}>
          <span className={`${styles.percentage} ${styles[level]}`}>{getUsageDisplay()}</span>
          {quota.expiryTime && expiryTimeStr && (
            <span className={styles.resetTime}>
              <IconTimer size={12} />
              <span>
                {t('quota.expires')}: {expiryTimeStr}
              </span>
            </span>
          )}
          {!quota.expiryTime && resetTimeStr && (
            <span className={styles.resetTime}>
              <IconTimer size={12} />
              <span>{resetTimeStr}</span>
            </span>
          )}
        </div>
      </div>
      <div className={styles.progressBar}>
        <div className={styles.progressTrack}>
          <div
            className={`${styles.progressFill} ${styles[level]}`}
            style={{ width: `${Math.max(0, Math.min(100, quota.remainingPercent))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface CollapsibleGroupProps {
  group: QuotaGroup;
  locale?: string;
  defaultExpanded?: boolean;
}

function CollapsibleGroup({ group, locale, defaultExpanded = false }: CollapsibleGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const level = getPercentLevel(group.avgRemainingPercent);
  const resetTimeStr = formatResetTime(group.earliestResetTime, locale);

  return (
    <div className={styles.collapsibleGroup}>
      <button
        className={styles.groupHeader}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className={styles.groupHeaderTop}>
          <div className={styles.groupLeft}>
            <span className={styles.groupName}>{group.displayName}</span>
            <span className={styles.modelCount}>({group.quotas.length})</span>
          </div>
          <div className={styles.groupRight}>
            <span className={`${styles.percentage} ${styles[level]}`}>
              {group.avgRemainingPercent.toFixed(0)}%
            </span>
            {resetTimeStr && (
              <span className={styles.resetTime}>
                <IconTimer size={12} />
                <span>{resetTimeStr}</span>
              </span>
            )}
            {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </div>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressTrack}>
            <div
              className={`${styles.progressFill} ${styles[level]}`}
              style={{ width: `${Math.max(0, Math.min(100, group.avgRemainingPercent))}%` }}
            />
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className={styles.groupContent}>
          {group.quotas.map((quota, index) => (
            <div key={`${quota.modelName}-${index}`} className={styles.modelRow}>
              <span className={styles.modelName}>{quota.displayName || quota.modelName}</span>
              <span
                className={`${styles.modelPercent} ${styles[getPercentLevel(quota.remainingPercent)]}`}
              >
                {quota.remainingPercent.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AccountCardProps {
  result: QuotaResult;
  locale?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

function AccountCard({ result, locale, t, onRefresh, refreshing }: AccountCardProps) {
  const hasError = !!result.error;
  const hasQuotas = result.quotas.length > 0;
  const hasGroups = result.groups && result.groups.length > 0;
  const avatarLetter = getAvatarLetter(result.email);

  return (
    <div className={`${styles.accountCard} ${hasError ? styles.hasError : ''}`}>
      {/* Top Header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardIdentity}>
          <div className={styles.avatar}>{avatarLetter}</div>
          <span className={styles.email}>{result.email}</span>
        </div>
        <div className={styles.cardActions}>
          {onRefresh && (
            <button
              className={styles.refreshBtn}
              onClick={onRefresh}
              disabled={refreshing}
              title={t('quota.refresh')}
            >
              <IconRefreshCw size={14} className={refreshing ? styles.spinning : ''} />
            </button>
          )}
          {result.subscriptionType && (
            <span className={styles.badge}>{result.subscriptionType}</span>
          )}
        </div>
      </div>

      {/* Tags Row (optional - for additional subscription info) */}
      {result.subscriptionType &&
        result.quotas.length > 0 &&
        result.quotas[0]?.subscriptionType &&
        result.quotas[0]?.subscriptionType !== result.subscriptionType && (
          <div className={styles.tagsRow}>
            <span className={styles.tag}>{result.quotas[0]?.subscriptionType}</span>
          </div>
        )}

      {/* Error State */}
      {hasError && <div className={styles.accountError}>{result.error}</div>}

      {/* Resource Groups (for Antigravity with collapsible groups) */}
      {hasGroups ? (
        <div className={styles.resourceList}>
          {result.groups!.map((group) => (
            <CollapsibleGroup key={group.category} group={group} locale={locale} />
          ))}
        </div>
      ) : hasQuotas ? (
        /* Resource Rows (flat list for Kiro) */
        <div className={styles.resourceList}>
          {result.quotas.map((quota, index) => (
            <ResourceRow key={`${quota.modelName}-${index}`} quota={quota} locale={locale} />
          ))}
        </div>
      ) : !hasError ? (
        <div className={styles.hint}>{t('quota.no_quota_data')}</div>
      ) : null}
    </div>
  );
}

interface ProviderSectionProps {
  provider: QuotaProvider;
  accounts: QuotaResult[];
  locale?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ProviderSection({ provider, accounts, locale, t }: ProviderSectionProps) {
  const config = PROVIDER_CONFIG[provider];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionLeft}>
          <span className={`${styles.providerIcon} ${styles[config.className]}`}>
            {config.icon}
          </span>
          <h2 className={styles.providerName}>{config.name}</h2>
        </div>
        <span className={styles.sectionCount}>
          {accounts.length} {t('quota.accounts')}
        </span>
      </div>

      <div className={styles.accountsList}>
        {accounts.map((result, index) => (
          <AccountCard key={`${result.email}-${index}`} result={result} locale={locale} t={t} />
        ))}
      </div>
    </section>
  );
}

export function QuotaPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const quotas = useQuotaStore((state) => state.quotas);
  const loading = useQuotaStore((state) => state.loading);
  const errors = useQuotaStore((state) => state.errors);
  const lastUpdated = useQuotaStore((state) => state.lastUpdated);
  const fetchQuotas = useQuotaStore((state) => state.fetchQuotas);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      fetchQuotas();
    }
  }, [connectionStatus, fetchQuotas]);

  const handleRefresh = () => {
    fetchQuotas();
  };

  // Group quotas by provider
  const groupedQuotas = useMemo(() => {
    const groups: Record<QuotaProvider, QuotaResult[]> = {
      antigravity: [],
      kiro: [],
    };

    for (const result of quotas) {
      if (groups[result.provider]) {
        groups[result.provider].push(result);
      }
    }

    return groups;
  }, [quotas]);

  const hasAntigravity = groupedQuotas.antigravity.length > 0;
  const hasKiro = groupedQuotas.kiro.length > 0;
  const hasAnyQuotas = hasAntigravity || hasKiro;

  const formatLastUpdated = () => {
    if (!lastUpdated) return '';
    const date = new Date(lastUpdated);
    return date.toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className={styles.container}>
      {loading && !hasAnyQuotas && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>{t('quota.title')}</h1>
          {lastUpdated && (
            <span className={styles.lastUpdated}>
              {t('quota.last_updated')}: {formatLastUpdated()}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            loading={loading}
            disabled={connectionStatus !== 'connected'}
          >
            {loading ? t('common.loading') : t('quota.refresh')}
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className={styles.errorBox}>
          <strong>{t('quota.errors_occurred')}:</strong>
          <ul className={styles.errorList}>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {!hasAnyQuotas && !loading && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon} aria-label="Chart icon">
            <IconChartLine size={48} />
          </div>
          <h3 className={styles.emptyTitle}>{t('quota.empty_title')}</h3>
          <p className={styles.emptyDesc}>{t('quota.empty_desc')}</p>
        </div>
      )}

      {hasAntigravity && (
        <ProviderSection
          provider="antigravity"
          accounts={groupedQuotas.antigravity}
          locale={i18n.language}
          t={t}
        />
      )}

      {hasKiro && (
        <ProviderSection
          provider="kiro"
          accounts={groupedQuotas.kiro}
          locale={i18n.language}
          t={t}
        />
      )}
    </div>
  );
}
