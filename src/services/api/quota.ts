/**
 * Quota API service
 * Fetches quota information from AI providers via Cloudflare Worker
 */

import { apiClient } from './client';
import type { AuthFileItem } from '@/types/authFile';
import type {
  QuotaProvider,
  AntigravityQuotaResponse,
  AntigravitySubscriptionResponse,
  KiroQuotaResponse,
  QuotaInfo,
  QuotaResult,
  QuotaGroup,
  ModelCategory,
  AntigravityAuthContent,
  KiroAuthContent,
} from '@/types/quota';

const CLOUDFLARE_WORKER_URL =
  import.meta.env.VITE_CLOUDFLARE_WORKER_URL ||
  'https://cliproxyapi.suytchetvigai1234.workers.dev/';

/**
 * Download auth file content from the server
 */
async function downloadAuthFileContent<T>(name: string): Promise<T> {
  const data = await apiClient.get<T>(`/auth-files/download?name=${encodeURIComponent(name)}`);
  return data;
}

/**
 * Fetch quota from Antigravity via Cloudflare Worker
 */
async function fetchAntigravityQuota(
  accessToken: string,
  projectId: string
): Promise<AntigravityQuotaResponse> {
  const response = await fetch(CLOUDFLARE_WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'antigravity',
      action: 'quota',
      accessToken,
      projectId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Antigravity quota fetch failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch subscription/tier info from Antigravity via Cloudflare Worker
 */
async function fetchAntigravitySubscription(
  accessToken: string
): Promise<AntigravitySubscriptionResponse> {
  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'antigravity',
        action: 'subscription',
        accessToken,
      }),
    });

    if (!response.ok) {
      // Don't throw, just log and return empty - subscription is optional
      let errorText = '';
      try {
        errorText = await response.text();
      } catch {
        // Ignore errors while reading error body
      }
      console.warn(
        `Antigravity subscription fetch failed: ${response.status}${errorText ? ' ' + errorText : ''}`
      );
      return {};
    }

    return response.json();
  } catch (error) {
    // Don't throw, just log and return empty - subscription is optional
    console.warn('Antigravity subscription fetch error:', error);
    return {};
  }
}

/**
 * Fetch quota from Kiro via Cloudflare Worker
 */
async function fetchKiroQuota(accessToken: string, profileArn: string): Promise<KiroQuotaResponse> {
  const response = await fetch(CLOUDFLARE_WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'kiro',
      accessToken,
      profileArn,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kiro quota fetch failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

// Category display names
const CATEGORY_DISPLAY_NAMES: Record<ModelCategory, string> = {
  'gemini-flash': 'Gemini Flash',
  'gemini-pro': 'Gemini Pro',
  claude: 'Claude',
  other: 'Other Models',
};

// Category order for display (Claude first)
const CATEGORY_ORDER: ModelCategory[] = ['claude', 'gemini-pro', 'gemini-flash', 'other'];

/**
 * Determine model category from model ID
 */
function getModelCategory(modelId: string): ModelCategory {
  const id = modelId.toLowerCase();

  if (id.includes('flash')) {
    return 'gemini-flash';
  }
  if (id.includes('gemini') && (id.includes('pro') || id.includes('image'))) {
    return 'gemini-pro';
  }
  if (id.includes('claude') || id.includes('sonnet') || id.includes('opus')) {
    return 'claude';
  }
  return 'other';
}

/**
 * Parse Antigravity response to unified QuotaInfo format with grouping
 * Includes Gemini Flash, Gemini Pro, and Claude models (excludes internal models)
 */
function parseAntigravityResponse(
  response: AntigravityQuotaResponse,
  email: string
): { quotas: QuotaInfo[]; groups: QuotaGroup[] } {
  const quotas: QuotaInfo[] = [];

  if (!response.models) {
    return { quotas, groups: [] };
  }

  for (const [modelId, modelData] of Object.entries(response.models)) {
    // Skip internal models (they have isInternal: true or no displayName)
    if (modelData.isInternal || !modelData.displayName) {
      continue;
    }

    const quotaInfo = modelData.quotaInfo;
    if (!quotaInfo) continue;

    const category = getModelCategory(modelId);
    const remainingPercent = (quotaInfo.remainingFraction ?? 1) * 100;
    const usedPercent = 100 - remainingPercent;

    quotas.push({
      provider: 'antigravity',
      email,
      modelName: modelId,
      displayName: modelData.displayName || modelId,
      used: usedPercent,
      limit: 100,
      remainingPercent,
      resetTime: quotaInfo.resetTime,
      category,
    });
  }

  // Group quotas by category
  const categoryMap = new Map<ModelCategory, QuotaInfo[]>();
  for (const quota of quotas) {
    const cat = quota.category || 'other';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push(quota);
  }

  // Create groups in order
  const groups: QuotaGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const categoryQuotas = categoryMap.get(category);
    if (!categoryQuotas || categoryQuotas.length === 0) continue;

    // Calculate average remaining percent
    const avgRemainingPercent =
      categoryQuotas.reduce((sum, q) => sum + q.remainingPercent, 0) / categoryQuotas.length;

    // Find earliest reset time
    const resetTimes = categoryQuotas
      .filter((q) => q.resetTime)
      .map((q) => new Date(q.resetTime!).getTime());
    const earliestResetTime =
      resetTimes.length > 0 ? new Date(Math.min(...resetTimes)).toISOString() : undefined;

    groups.push({
      category,
      displayName: CATEGORY_DISPLAY_NAMES[category],
      quotas: categoryQuotas,
      avgRemainingPercent,
      earliestResetTime,
    });
  }

  return { quotas, groups };
}

/**
 * Parse Kiro response to unified QuotaInfo format
 * Creates entries for both Monthly Credits and Free Trial (if active)
 */
function parseKiroResponse(response: KiroQuotaResponse, email: string): QuotaInfo[] {
  const quotas: QuotaInfo[] = [];

  if (!response.usageBreakdownList) {
    return quotas;
  }

  const subscriptionType = response.subscriptionInfo?.subscriptionTitle || 'Unknown';

  for (const usage of response.usageBreakdownList) {
    // Monthly Credits entry
    const monthlyUsed = usage.currentUsage ?? 0;
    const monthlyLimit = usage.usageLimit ?? 0;
    const monthlyRemainingPercent =
      monthlyLimit > 0 ? ((monthlyLimit - monthlyUsed) / monthlyLimit) * 100 : 0;
    const resetTime = usage.nextDateReset
      ? new Date(usage.nextDateReset * 1000).toISOString()
      : undefined;

    quotas.push({
      provider: 'kiro',
      email,
      modelName: 'Monthly Credits',
      displayName: 'Monthly Credits',
      used: monthlyUsed,
      limit: monthlyLimit,
      remainingPercent: monthlyRemainingPercent,
      resetTime,
      subscriptionType,
      isAbsoluteValue: true,
    });

    // Free Trial entry (only if not expired)
    const trialInfo = usage.freeTrialInfo;
    if (trialInfo && trialInfo.freeTrialStatus !== 'EXPIRED') {
      const trialUsed = trialInfo.currentUsageWithPrecision ?? trialInfo.currentUsage ?? 0;
      const trialLimit = trialInfo.usageLimitWithPrecision ?? trialInfo.usageLimit ?? 0;
      const trialRemainingPercent =
        trialLimit > 0 ? ((trialLimit - trialUsed) / trialLimit) * 100 : 0;
      const expiryTime = trialInfo.freeTrialExpiry
        ? new Date(trialInfo.freeTrialExpiry * 1000).toISOString()
        : undefined;

      quotas.push({
        provider: 'kiro',
        email,
        modelName: 'Free Trial',
        displayName: 'Free Trial',
        used: Math.round(trialUsed * 100) / 100, // Round to 2 decimal places
        limit: trialLimit,
        remainingPercent: trialRemainingPercent,
        subscriptionType,
        isAbsoluteValue: true,
        expiryTime,
      });
    }
  }

  return quotas;
}

/**
 * Fetch quota for a single auth file
 */
async function fetchQuotaForAuthFile(authFile: AuthFileItem): Promise<QuotaResult> {
  const provider = authFile.type as QuotaProvider;
  let email = '';

  try {
    if (provider === 'antigravity') {
      const content = await downloadAuthFileContent<AntigravityAuthContent>(authFile.name);
      email = content.email || authFile.name;

      if (!content.access_token || !content.project_id) {
        throw new Error('Missing access_token or project_id');
      }

      // Fetch quota and subscription in parallel
      const [quotaResponse, subscriptionResponse] = await Promise.all([
        fetchAntigravityQuota(content.access_token, content.project_id),
        fetchAntigravitySubscription(content.access_token),
      ]);

      const { quotas, groups } = parseAntigravityResponse(quotaResponse, email);

      // Use paidTier if available (e.g., "Google AI Pro"), otherwise fallback to currentTier
      // paidTier indicates user has a paid subscription, currentTier is the active tier
      const subscriptionType =
        subscriptionResponse.paidTier?.name || subscriptionResponse.currentTier?.name || undefined;

      return { provider, email, quotas, groups, subscriptionType };
    } else if (provider === 'kiro') {
      const content = await downloadAuthFileContent<KiroAuthContent>(authFile.name);
      email = content.email || authFile.name;

      if (!content.access_token || !content.profile_arn) {
        throw new Error('Missing access_token or profile_arn');
      }

      const response = await fetchKiroQuota(content.access_token, content.profile_arn);
      const quotas = parseKiroResponse(response, email);
      const subscriptionType = response.subscriptionInfo?.subscriptionTitle;

      return { provider, email, quotas, subscriptionType };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      provider,
      email: email || authFile.name,
      quotas: [],
      error: message,
    };
  }
}

/**
 * Fetch quotas for all supported auth files (Antigravity and Kiro)
 */
async function fetchAllQuotas(authFiles: AuthFileItem[]): Promise<QuotaResult[]> {
  const supportedFiles = authFiles.filter(
    (file) => file.type === 'antigravity' || file.type === 'kiro'
  );

  if (supportedFiles.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    supportedFiles.map((file) => fetchQuotaForAuthFile(file))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const file = supportedFiles[index];
    return {
      provider: file.type as QuotaProvider,
      email: file.name,
      quotas: [],
      error: result.reason?.message || 'Unknown error',
    };
  });
}

export const quotaApi = {
  fetchAllQuotas,
  fetchQuotaForAuthFile,
  downloadAuthFileContent,
};
