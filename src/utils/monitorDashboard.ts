import {
  calculateCacheHitRatio,
  isAnthropicProvider,
  resolvePriceForContext,
  type ModelPrice,
  type UsageDetail,
} from './usage';
import { resolveTierMultiplier } from './tierMultiplier';

export type MonitorGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month';
export type MonitorShareMetric = 'requests' | 'tokens' | 'cost';
export type MonitorDimension = 'model' | 'apiKey';
export type MonitorResultFilter = 'all' | 'success' | 'failed';

export interface MonitorTrendPoint {
  key: string;
  timestamp: number;
  input: number;
  output: number;
  cacheRead: number;
  requests: number;
  failed: number;
  cost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheCreationCost: number;
  pricedRequests: number;
  cacheHitRate: number | null;
}

export interface MonitorModelRow {
  model: string;
  requests: number;
  failed: number;
  input: number;
  output: number;
  cacheRead: number;
  tokens: number;
  cost: number;
  averageLatencyMs: number | null;
  averageTtftMs: number | null;
}

export interface MonitorDimensionRow extends MonitorModelRow {
  name: string;
}

export interface MonitorSummary {
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  failedRequests: number;
  topModel: string | null;
  pricedRequests: number;
}

export interface MonitorDashboardData {
  summary: MonitorSummary;
  trend: MonitorTrendPoint[];
  models: MonitorModelRow[];
  apiKeys: MonitorDimensionRow[];
}

export interface MonitorRequestFilters {
  model: string;
  source: string;
  result: MonitorResultFilter;
  search: string;
}

const validNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getCacheReadTokens = (detail: UsageDetail): number =>
  Math.max(
    validNumber(detail.tokens.cache_read_tokens),
    validNumber(detail.tokens.cached_tokens),
    validNumber(detail.tokens.cache_tokens)
  );

export const getRequestTotalTokens = (detail: UsageDetail): number => {
  const total = validNumber(detail.tokens.total_tokens);
  if (total > 0) return total;
  return (
    validNumber(detail.tokens.input_tokens) +
    validNumber(detail.tokens.output_tokens) +
    validNumber(detail.tokens.reasoning_tokens)
  );
};

interface MonitorCostBreakdown {
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  priced: boolean;
}

const calculateCostBreakdown = (
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
): MonitorCostBreakdown => {
  const model = detail.__modelName || '';
  const price = modelPrices[model];
  if (!price) {
    return { total: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, priced: false };
  }
  const inputTokens = validNumber(detail.tokens.input_tokens);
  const outputTokens = validNumber(detail.tokens.output_tokens);
  const cacheReadTokens = getCacheReadTokens(detail);
  const cacheCreationTokens = validNumber(detail.tokens.cache_creation_tokens);
  const pureInputTokens = isAnthropicProvider(detail.provider)
    ? inputTokens
    : Math.max(inputTokens - cacheReadTokens - cacheCreationTokens, 0);
  const contextTokens = pureInputTokens + cacheReadTokens + cacheCreationTokens;
  const tier = resolvePriceForContext(price, contextTokens);
  const multiplier = resolveTierMultiplier(model, detail.service_tier);
  const input = (pureInputTokens / 1_000_000) * tier.input * multiplier;
  const output = (outputTokens / 1_000_000) * tier.output * multiplier;
  const cacheRead = (cacheReadTokens / 1_000_000) * tier.cacheRead * multiplier;
  const cacheCreation = (cacheCreationTokens / 1_000_000) * tier.cacheCreate * multiplier;
  return {
    total: input + output + cacheRead + cacheCreation,
    input,
    output,
    cacheRead,
    cacheCreation,
    priced: true,
  };
};

export const filterDetailsByRange = (
  details: UsageDetail[],
  startMs: number,
  endMs: number
): UsageDetail[] =>
  details.filter((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    return Number.isFinite(timestamp) && timestamp >= startMs && timestamp < endMs;
  });

const startOfBucket = (timestamp: number, granularity: MonitorGranularity): number => {
  const date = new Date(timestamp);
  if (granularity === 'minute') {
    date.setUTCSeconds(0, 0);
  } else if (granularity === 'hour') {
    date.setUTCMinutes(0, 0, 0);
  } else if (granularity === 'day') {
    date.setUTCHours(0, 0, 0, 0);
  } else if (granularity === 'week') {
    date.setUTCHours(0, 0, 0, 0);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  } else {
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.getTime();
};

interface MutableBucket extends MonitorTrendPoint {
  cacheContext: number;
  cacheHits: number;
}

const createBucket = (timestamp: number): MutableBucket => ({
  key: new Date(timestamp).toISOString(),
  timestamp,
  input: 0,
  output: 0,
  cacheRead: 0,
  requests: 0,
  failed: 0,
  cost: 0,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheCreationCost: 0,
  pricedRequests: 0,
  cacheHitRate: null,
  cacheContext: 0,
  cacheHits: 0,
});

interface MutableDimension extends MonitorDimensionRow {
  latencyTotal: number;
  latencyCount: number;
  ttftTotal: number;
  ttftCount: number;
}

const createDimension = (name: string): MutableDimension => ({
  name,
  model: name,
  requests: 0,
  failed: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  tokens: 0,
  cost: 0,
  averageLatencyMs: null,
  averageTtftMs: null,
  latencyTotal: 0,
  latencyCount: 0,
  ttftTotal: 0,
  ttftCount: 0,
});

const addDetailToDimension = (
  target: MutableDimension,
  detail: UsageDetail,
  cost: number
): void => {
  target.requests += 1;
  target.failed += detail.failed ? 1 : 0;
  target.input += validNumber(detail.tokens.input_tokens);
  target.output += validNumber(detail.tokens.output_tokens);
  target.cacheRead += getCacheReadTokens(detail);
  target.tokens += getRequestTotalTokens(detail);
  target.cost += cost;
  const latency = validNumber(detail.latency_ms);
  if (latency > 0) {
    target.latencyTotal += latency;
    target.latencyCount += 1;
  }
  const ttft = validNumber(detail.ttft_ms);
  if (ttft > 0) {
    target.ttftTotal += ttft;
    target.ttftCount += 1;
  }
};

const finalizeDimension = (row: MutableDimension): MonitorDimensionRow => ({
  name: row.name,
  model: row.model,
  requests: row.requests,
  failed: row.failed,
  input: row.input,
  output: row.output,
  cacheRead: row.cacheRead,
  tokens: row.tokens,
  cost: row.cost,
  averageLatencyMs: row.latencyCount ? row.latencyTotal / row.latencyCount : null,
  averageTtftMs: row.ttftCount ? row.ttftTotal / row.ttftCount : null,
});

export const buildMonitorDashboardData = (
  details: UsageDetail[],
  modelPrices: Record<string, ModelPrice>,
  granularity: MonitorGranularity
): MonitorDashboardData => {
  const buckets = new Map<number, MutableBucket>();
  const models = new Map<string, MutableDimension>();
  const apiKeys = new Map<string, MutableDimension>();
  let totalTokens = 0;
  let totalCost = 0;
  let failedRequests = 0;
  let pricedRequests = 0;

  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp)) return;
    const model = detail.__modelName?.trim() || 'unknown';
    const apiKey =
      String((detail as UsageDetail & { __endpoint?: string }).__endpoint ?? '').trim() ||
      String(detail.auth_index ?? '').trim() ||
      detail.source.trim() ||
      'unknown';
    const input = validNumber(detail.tokens.input_tokens);
    const output = validNumber(detail.tokens.output_tokens);
    const cacheRead = getCacheReadTokens(detail);
    const tokens = getRequestTotalTokens(detail);
    const costBreakdown = calculateCostBreakdown(detail, modelPrices);
    const cost = costBreakdown.total;
    const bucketTimestamp = startOfBucket(timestamp, granularity);
    const bucket = buckets.get(bucketTimestamp) ?? createBucket(bucketTimestamp);
    const hitRate = calculateCacheHitRatio({
      provider: detail.provider,
      inputTokens: input,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: validNumber(detail.tokens.cache_creation_tokens),
    });

    bucket.input += input;
    bucket.output += output;
    bucket.cacheRead += cacheRead;
    bucket.requests += 1;
    bucket.failed += detail.failed ? 1 : 0;
    bucket.cost += cost;
    bucket.inputCost += costBreakdown.input;
    bucket.outputCost += costBreakdown.output;
    bucket.cacheReadCost += costBreakdown.cacheRead;
    bucket.cacheCreationCost += costBreakdown.cacheCreation;
    bucket.pricedRequests += costBreakdown.priced ? 1 : 0;
    if (hitRate !== null) {
      const context =
        hitRate > 0
          ? cacheRead / hitRate
          : input + cacheRead + validNumber(detail.tokens.cache_creation_tokens);
      bucket.cacheContext += context;
      bucket.cacheHits += cacheRead;
    }
    buckets.set(bucketTimestamp, bucket);

    const modelRow = models.get(model) ?? createDimension(model);
    addDetailToDimension(modelRow, detail, cost);
    models.set(model, modelRow);

    const apiKeyRow = apiKeys.get(apiKey) ?? createDimension(apiKey);
    addDetailToDimension(apiKeyRow, detail, cost);
    apiKeys.set(apiKey, apiKeyRow);

    totalTokens += tokens;
    totalCost += cost;
    failedRequests += detail.failed ? 1 : 0;
    pricedRequests += costBreakdown.priced ? 1 : 0;
  });

  const trend = Array.from(buckets.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ cacheContext, cacheHits, ...bucket }) => ({
      ...bucket,
      cacheHitRate: cacheContext > 0 ? cacheHits / cacheContext : null,
    }));
  const modelRows = Array.from(models.values())
    .map(finalizeDimension)
    .map(({ name: _name, ...row }) => row)
    .sort((a, b) => b.requests - a.requests);
  const apiKeyRows = Array.from(apiKeys.values())
    .map(finalizeDimension)
    .sort((a, b) => b.requests - a.requests);

  return {
    summary: {
      totalTokens,
      totalCost,
      totalRequests: details.length,
      failedRequests,
      topModel: modelRows[0]?.model ?? null,
      pricedRequests,
    },
    trend,
    models: modelRows,
    apiKeys: apiKeyRows,
  };
};

export const filterMonitorRequests = (
  details: UsageDetail[],
  filters: MonitorRequestFilters
): UsageDetail[] => {
  const search = filters.search.trim().toLowerCase();
  return details.filter((detail) => {
    const model = detail.__modelName || 'unknown';
    if (filters.model && model !== filters.model) return false;
    if (filters.source && detail.source !== filters.source) return false;
    if (filters.result === 'success' && detail.failed) return false;
    if (filters.result === 'failed' && !detail.failed) return false;
    if (!search) return true;
    return [
      model,
      detail.source,
      detail.provider,
      detail.auth_index,
      detail.failure_body,
      detail.failure_status_code,
    ].some((value) =>
      String(value ?? '')
        .toLowerCase()
        .includes(search)
    );
  });
};

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const buildMonitorRequestsCsv = (details: UsageDetail[]): string => {
  const header = [
    'timestamp',
    'model',
    'source',
    'provider',
    'result',
    'status_code',
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'total_tokens',
    'latency_ms',
    'ttft_ms',
  ];
  const rows = details.map((detail) => [
    detail.timestamp,
    detail.__modelName || 'unknown',
    detail.source,
    detail.provider || '',
    detail.failed ? 'failed' : 'success',
    detail.failure_status_code || '',
    validNumber(detail.tokens.input_tokens),
    validNumber(detail.tokens.output_tokens),
    validNumber(detail.tokens.reasoning_tokens),
    getCacheReadTokens(detail),
    getRequestTotalTokens(detail),
    validNumber(detail.latency_ms),
    validNumber(detail.ttft_ms),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
};
