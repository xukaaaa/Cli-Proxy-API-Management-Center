import type { QuotaPolicy } from '@/types/quotaManagement';

// Format currency
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Format large numbers (tokens)
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

// Calculate usage percentage
export function calculateUsagePercent(used: number, limit: number): number {
  if (limit === 0) return 0;
  return Math.min(100, (used / limit) * 100);
}

// Check if policy is expired
export function isPolicyExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// Validate policy form
export function validatePolicy(policy: Partial<QuotaPolicy>): string | null {
  // At least one field must be set
  if (
    !policy.name &&
    !policy.allowed_models?.length &&
    !policy.max_tokens &&
    !policy.max_cost_usd &&
    !policy.expires_at
  ) {
    return 'At least one field is required';
  }

  // Validate numbers
  if (policy.max_tokens !== undefined && policy.max_tokens <= 0) {
    return 'Max tokens must be positive';
  }
  if (policy.max_cost_usd !== undefined && policy.max_cost_usd <= 0) {
    return 'Max cost must be positive';
  }

  // Validate date
  if (policy.expires_at) {
    const date = new Date(policy.expires_at);
    if (isNaN(date.getTime())) {
      return 'Invalid expiry date';
    }
    if (date < new Date()) {
      return 'Expiry date must be in the future';
    }
  }

  return null;
}
