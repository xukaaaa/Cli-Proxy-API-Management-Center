/**
 * Quota state management
 * Manages quota information for AI providers
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthFileItem } from '@/types/authFile';
import type { QuotaResult } from '@/types/quota';
import { quotaApi } from '@/services/api/quota';
import { authFilesApi } from '@/services/api/authFiles';

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

interface QuotaState {
  quotas: QuotaResult[];
  loading: boolean;
  errors: string[];
  lastUpdated: number | null;

  // Actions
  fetchQuotas: (forceRefresh?: boolean) => Promise<void>;
  clearQuotas: () => void;
}

export const useQuotaStore = create<QuotaState>()(
  persist(
    (set, get) => ({
      quotas: [],
      loading: false,
      errors: [],
      lastUpdated: null,

      fetchQuotas: async (forceRefresh = false) => {
        const { lastUpdated, quotas, loading } = get();
        
        // Skip if already loading
        if (loading) return;
        
        // Use cache if valid and not forcing refresh
        if (!forceRefresh && lastUpdated && quotas.length > 0) {
          const cacheAge = Date.now() - lastUpdated;
          if (cacheAge < CACHE_DURATION) {
            return;
          }
        }

        set({ loading: true, errors: [] });

        try {
          // First get the list of auth files
          const authFilesResponse = await authFilesApi.list();
          const authFiles: AuthFileItem[] = authFilesResponse.files || [];

          // Filter for supported providers
          const supportedFiles = authFiles.filter(
            (file) => file.type === 'antigravity' || file.type === 'kiro'
          );

          if (supportedFiles.length === 0) {
            set({
              quotas: [],
              loading: false,
              lastUpdated: Date.now()
            });
            return;
          }

          // Fetch quotas for all supported files
          const results = await quotaApi.fetchAllQuotas(supportedFiles);

          // Collect any errors
          const errors = results
            .filter((r) => r.error)
            .map((r) => `${r.email}: ${r.error}`);

          set({
            quotas: results,
            loading: false,
            errors,
            lastUpdated: Date.now()
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to fetch quotas';
          set({
            loading: false,
            errors: [message]
          });
        }
      },

      clearQuotas: () => {
        set({
          quotas: [],
          loading: false,
          errors: [],
          lastUpdated: null
        });
      }
    }),
    {
      name: 'quota-storage',
      partialize: (state) => ({
        quotas: state.quotas,
        lastUpdated: state.lastUpdated
      })
    }
  )
);
