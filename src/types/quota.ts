/**
 * Quota check related types
 */

export type QuotaProvider = 'antigravity' | 'kiro';

/** Model category for grouping */
export type ModelCategory = 'gemini-flash' | 'gemini-pro' | 'claude' | 'other';

// Antigravity API response format (extended with more fields)
export interface AntigravityModel {
  displayName?: string;
  model?: string;
  modelProvider?: string;
  apiProvider?: string;
  isInternal?: boolean;
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
  /** If true, display as "remaining/limit" instead of percentage */
  isAbsoluteValue?: boolean;
  /** For free trial expiry time (ISO string) */
  expiryTime?: string;
  /** Model category for grouping (Antigravity only) */
  category?: ModelCategory;
}

/** Grouped quotas by category (for Antigravity) */
export interface QuotaGroup {
  category: ModelCategory;
  displayName: string;
  quotas: QuotaInfo[];
  /** Average remaining percent across all models in group */
  avgRemainingPercent: number;
  /** Earliest reset time in group */
  earliestResetTime?: string;
}

export interface QuotaResult {
  provider: QuotaProvider;
  email: string;
  quotas: QuotaInfo[];
  /** Grouped quotas for collapsible display (Antigravity) */
  groups?: QuotaGroup[];
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

// ============================================
// Types from upstream for quota management UI
// ============================================

// Theme types
export type ThemeColors = { bg: string; text: string; border?: string };
export type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
export type ResolvedTheme = 'light' | 'dark';

// GeminiCli API payload types
export interface GeminiCliQuotaBucket {
  modelId?: string;
  model_id?: string;
  tokenType?: string;
  token_type?: string;
  remainingFraction?: number | string;
  remaining_fraction?: number | string;
  remainingAmount?: number | string;
  remaining_amount?: number | string;
  resetTime?: string;
  reset_time?: string;
}

export interface GeminiCliQuotaPayload {
  buckets?: GeminiCliQuotaBucket[];
}

// Antigravity quota info (upstream format)
export interface AntigravityQuotaInfo {
  displayName?: string;
  quotaInfo?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
  quota_info?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
}

export type AntigravityModelsPayload = Record<string, AntigravityQuotaInfo>;

export interface AntigravityQuotaGroupDefinition {
  id: string;
  label: string;
  identifiers: string[];
  labelFromModel?: boolean;
}

export interface GeminiCliQuotaGroupDefinition {
  id: string;
  label: string;
  modelIds: string[];
}

export interface GeminiCliParsedBucket {
  modelId: string;
  tokenType: string | null;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
}

// Codex types
export interface CodexUsageWindow {
  used_percent?: number | string;
  usedPercent?: number | string;
  limit_window_seconds?: number | string;
  limitWindowSeconds?: number | string;
  reset_after_seconds?: number | string;
  resetAfterSeconds?: number | string;
  reset_at?: number | string;
  resetAt?: number | string;
}

export interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  limitReached?: boolean;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
}

export interface CodexUsagePayload {
  plan_type?: string;
  planType?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
  code_review_rate_limit?: CodexRateLimitInfo | null;
  codeReviewRateLimit?: CodexRateLimitInfo | null;
}

// Quota state types
export interface AntigravityQuotaGroup {
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  resetTime?: string;
}

export interface AntigravityQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  groups: AntigravityQuotaGroup[];
  error?: string;
  errorStatus?: number;
}

export interface GeminiCliQuotaBucketState {
  id: string;
  label: string;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
  tokenType: string | null;
  modelIds?: string[];
}

export interface GeminiCliQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  buckets: GeminiCliQuotaBucketState[];
  error?: string;
  errorStatus?: number;
}

export interface CodexQuotaWindow {
  id: string;
  label: string;
  labelKey?: string;
  usedPercent: number | null;
  resetLabel: string;
}

export interface CodexQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: CodexQuotaWindow[];
  planType?: string | null;
  error?: string;
  errorStatus?: number;
}
