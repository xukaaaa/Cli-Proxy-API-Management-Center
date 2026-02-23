/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi'
  | 'qwen'
  | 'kiro';

export type KiroAuthMethod = 'google' | 'github' | 'aws';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface IFlowCookieAuthResponse {
  status: 'ok' | 'error';
  error?: string;
  saved_path?: string;
  email?: string;
  expired?: string;
  type?: string;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'kiro'];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini'
};

export interface KiroAuthStatusResponse {
  status: 'ok' | 'wait' | 'error' | 'auth_url' | 'device_code';
  url?: string;
  verification_url?: string;
  user_code?: string;
  error?: string;
}

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: { projectId?: string; method?: KiroAuthMethod }) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    if (provider === 'kiro' && options?.method) {
      params.method = options.method;
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<KiroAuthStatusResponse>(`/get-auth-status`, {
      params: { state }
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl
    });
  },

  /** iFlow cookie 认证 */
  iflowCookieAuth: (cookie: string) =>
    apiClient.post<IFlowCookieAuthResponse>('/iflow-auth-url', { cookie })
};
