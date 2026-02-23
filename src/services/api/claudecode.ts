/**
 * Claude Code Integration (claudecode) 相关 API
 */

import { apiClient } from './client';
import { normalizeClaudeCodeConfig, normalizeClaudeCodeModelMappings } from './transformers';
import type { ClaudeCodeConfig, ClaudeCodeModelMapping } from '@/types';

export const claudecodeApi = {
  async getClaudeCode(): Promise<ClaudeCodeConfig> {
    const data = await apiClient.get('/claudecode');
    return normalizeClaudeCodeConfig(data) ?? {};
  },

  async getModelMappings(): Promise<ClaudeCodeModelMapping[]> {
    const data = await apiClient.get('/claudecode/model-mappings');
    const list = (data as any)?.['model-mappings'] ?? (data as any)?.modelMappings ?? (data as any)?.items ?? data;
    return normalizeClaudeCodeModelMappings(list);
  },

  saveModelMappings: (mappings: ClaudeCodeModelMapping[]) =>
    apiClient.put('/claudecode/model-mappings', { value: mappings }),
  patchModelMappings: (mappings: ClaudeCodeModelMapping[]) =>
    apiClient.patch('/claudecode/model-mappings', { value: mappings }),
  clearModelMappings: () => apiClient.delete('/claudecode/model-mappings'),
  deleteModelMappings: (fromList: string[]) =>
    apiClient.delete('/claudecode/model-mappings', { data: { value: fromList } }),

  updateForceModelMappings: (enabled: boolean) => apiClient.put('/claudecode/force-model-mappings', { value: enabled })
};
