/**
 * Quota check related types
 */

export type QuotaProvider = 'antigravity' | 'kiro';

// Antigravity API response format
export interface AntigravityModel {
  displayName: string;
  quotaInfo?: {
    remainingFraction: number;
    resetTime?: string;
  };
}

export interface AntigravityQuotaResponse {
  models?: Record<string, AntigravityModel>;
}

// Antigravity subscription/tier info
export interface AntigravityTier {
  id: string;
  name: string;
  description?: string;
}

export interface AntigravitySubscriptionResponse {
  currentTier?: AntigravityTier;
  paidTier?: AntigravityTier;
  cloudaicompanionProject?: string;
}

// Kiro API response format
export interface KiroSubscriptionInfo {
  subscriptionTitle: string;
  type: string;
}

export interface KiroFreeTrialInfo {
  currentUsage: number;
  currentUsageWithPrecision: number;
  usageLimit: number;
  usageLimitWithPrecision: number;
  freeTrialExpiry: number;
  freeTrialStatus: 'ACTIVE' | 'EXPIRED' | string;
}

export interface KiroUsageBreakdown {
  currentUsage: number;
  usageLimit: number;
  displayName: string;
  nextDateReset?: number;
  freeTrialInfo?: KiroFreeTrialInfo;
}

export interface KiroUserInfo {
  email: string;
}

export interface KiroQuotaResponse {
  subscriptionInfo?: KiroSubscriptionInfo;
  usageBreakdownList?: KiroUsageBreakdown[];
  userInfo?: KiroUserInfo;
}

// Unified quota info
export interface QuotaInfo {
  provider: QuotaProvider;
  email: string;
  modelName: string;
  displayName?: string;
  used: number;
  limit: number;
  remainingPercent: number;
  resetTime?: string;
  subscriptionType?: string;
  /** If true, display as "used/limit" instead of percentage */
  isAbsoluteValue?: boolean;
  /** For free trial expiry time (ISO string) */
  expiryTime?: string;
}

export interface QuotaResult {
  provider: QuotaProvider;
  email: string;
  quotas: QuotaInfo[];
  error?: string;
  subscriptionType?: string;
}

// Auth file content for quota fetching
export interface AntigravityAuthContent {
  access_token: string;
  project_id: string;
  email?: string;
}

export interface KiroAuthContent {
  access_token: string;
  profile_arn: string;
  email?: string;
}

export type AuthFileContent = AntigravityAuthContent | KiroAuthContent;
