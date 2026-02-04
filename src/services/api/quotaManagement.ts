import { apiClient } from './client';
import type {
  PoliciesResponse,
  UsageResponse,
  QuotaPolicy,
  QuotaStatus,
  QuotaUsage
} from '@/types/quotaManagement';

const QUOTA_BASE = '/quota';

export const quotaManagementApi = {
  // Policies
  async listPolicies(): Promise<PoliciesResponse> {
    return apiClient.get(`${QUOTA_BASE}/policies`);
  },

  async getPolicy(apiKey: string): Promise<{ api_key: string; policy: QuotaPolicy }> {
    return apiClient.get(`${QUOTA_BASE}/policies/${apiKey}`);
  },

  async createOrUpdatePolicy(apiKey: string, policy: QuotaPolicy): Promise<void> {
    return apiClient.put(`${QUOTA_BASE}/policies/${apiKey}`, policy);
  },

  async deletePolicy(apiKey: string): Promise<void> {
    return apiClient.delete(`${QUOTA_BASE}/policies/${apiKey}`);
  },

  // Usage
  async listUsage(): Promise<UsageResponse> {
    return apiClient.get(`${QUOTA_BASE}/usage`);
  },

  async getUsage(apiKey: string): Promise<{ usage: QuotaUsage }> {
    return apiClient.get(`${QUOTA_BASE}/usage/${apiKey}`);
  },

  // Status (combined)
  async getStatus(apiKey: string): Promise<QuotaStatus> {
    return apiClient.get(`${QUOTA_BASE}/status/${apiKey}`);
  }
};
