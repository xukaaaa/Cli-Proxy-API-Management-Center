export interface QuotaPolicy {
  name?: string;
  allowed_models?: string[];
  max_tokens?: number;
  max_cost_usd?: number;
  expires_at?: string; // ISO date string
}

export interface QuotaUsage {
  api_key: string;
  total_tokens: number;
  total_cost_usd: number;
  total_requests: number;
  last_used_at: string;
  created_at: string;
}

export interface QuotaStatus {
  api_key: string;
  has_policy: boolean;
  has_usage: boolean;
  policy?: QuotaPolicy & {
    is_expired: boolean;
  };
  usage?: QuotaUsage;
  remaining_tokens?: number;
  token_usage_percent?: number;
  remaining_cost_usd?: number;
  cost_usage_percent?: number;
}

export interface PoliciesResponse {
  count: number;
  policies: Record<string, QuotaPolicy>;
}

export interface UsageResponse {
  count: number;
  usage: Record<string, QuotaUsage>;
}

export interface QuotaManagementItem {
  apiKey: string;
  policy?: QuotaPolicy;
  usage?: QuotaUsage;
  status?: QuotaStatus;
}
