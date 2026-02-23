import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { claudecodeApi, modelsApi } from '@/services/api';
import type { ClaudeCodeConfig } from '@/types';
import { buildClaudeCodeFormState, buildOpenAIModelsEndpoint, entriesToClaudeCodeMappings } from '../utils';
import type { ClaudeCodeFormState } from '../types';

interface ClaudeCodeModalProps {
  isOpen: boolean;
  disableControls: boolean;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ClaudeCodeModal({ isOpen, disableControls, onClose, onBusyChange }: ClaudeCodeModalProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const config = useConfigStore((state) => state.config);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const apiBase = useAuthStore((state) => state.apiBase);

  const [form, setForm] = useState<ClaudeCodeFormState>(() => buildClaudeCodeFormState(null));
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mappingsDirty, setMappingsDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelEndpoint, setModelEndpoint] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState('');
  const initializedRef = useRef(false);
  const modelOptionsRequestIdRef = useRef(0);

  const getErrorMessage = useCallback((err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  }, []);

  const normalizeModelOptions = useCallback(
    (models: Array<{ name?: string }>) =>
      Array.from(
        new Set(models.map((model) => String(model?.name || '').trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    []
  );

  const mergedModelOptions = useMemo(() => {
    const mappingTargets = form.mappingEntries
      .map((entry) => entry.alias.trim())
      .filter(Boolean);
    return Array.from(new Set([...modelOptions, ...mappingTargets])).sort((a, b) => a.localeCompare(b));
  }, [form.mappingEntries, modelOptions]);

  const thinkingBudgetOptions = useMemo(
    () => ['minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'none', '512', '1024', '8192', '24576', '32768'],
    []
  );

  const fetchClaudeCodeModelOptions = useCallback(
    async ({ allowFallback = true }: { allowFallback?: boolean } = {}) => {
      const requestId = modelOptionsRequestIdRef.current + 1;
      modelOptionsRequestIdRef.current = requestId;

      const applyIfLatest = (apply: () => void) => {
        if (modelOptionsRequestIdRef.current !== requestId) return;
        apply();
      };

      const trimmedBaseUrl = apiBase.trim();
      if (!trimmedBaseUrl) {
        applyIfLatest(() => {
          setModelEndpoint('');
          setModelOptions([]);
          setModelOptionsError(t('ai_providers.claudecode_models_fetch_invalid_url'));
          setModelOptionsLoading(false);
        });
        return;
      }

      applyIfLatest(() => {
        setModelOptionsLoading(true);
        setModelOptionsError('');
        setModelEndpoint(buildOpenAIModelsEndpoint(trimmedBaseUrl));
      });

      const firstApiKey = config?.apiKeys?.find((key) => String(key || '').trim())?.trim();
      try {
        const list = await modelsApi.fetchV1ModelsViaApiCall(trimmedBaseUrl, firstApiKey);
        applyIfLatest(() => {
          setModelOptions(normalizeModelOptions(list));
        });
      } catch (err: unknown) {
        if (allowFallback && firstApiKey) {
          try {
            const list = await modelsApi.fetchV1ModelsViaApiCall(trimmedBaseUrl);
            applyIfLatest(() => {
              setModelOptions(normalizeModelOptions(list));
            });
            return;
          } catch (fallbackErr: unknown) {
            const message = getErrorMessage(fallbackErr) || getErrorMessage(err);
            applyIfLatest(() => {
              setModelOptions([]);
              setModelOptionsError(`${t('ai_providers.claudecode_models_fetch_error')}: ${message}`);
            });
          }
        } else {
          applyIfLatest(() => {
            setModelOptions([]);
            setModelOptionsError(`${t('ai_providers.claudecode_models_fetch_error')}: ${getErrorMessage(err)}`);
          });
        }
      } finally {
        applyIfLatest(() => {
          setModelOptionsLoading(false);
        });
      }
    },
    [apiBase, config?.apiKeys, getErrorMessage, normalizeModelOptions, t]
  );

  useEffect(() => {
    onBusyChange?.(loading || saving || modelOptionsLoading);
  }, [loading, saving, modelOptionsLoading, onBusyChange]);

  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
      modelOptionsRequestIdRef.current += 1;
      setLoading(false);
      setSaving(false);
      setError('');
      setLoaded(false);
      setMappingsDirty(false);
      setModelEndpoint('');
      setModelOptions([]);
      setModelOptionsError('');
      setModelOptionsLoading(false);
      setForm(buildClaudeCodeFormState(null));
      onBusyChange?.(false);
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;

    setLoading(true);
    setLoaded(false);
    setMappingsDirty(false);
    setError('');
    setModelOptionsError('');
    setModelOptions([]);
    setForm(buildClaudeCodeFormState(config?.claudecode ?? null));
    void fetchClaudeCodeModelOptions();

    void (async () => {
      try {
        const claudecode = await claudecodeApi.getClaudeCode();
        setLoaded(true);
        updateConfigValue('claudecode', claudecode);
        clearCache('claudecode');
        setForm(buildClaudeCodeFormState(claudecode));
      } catch (err: unknown) {
        setError(getErrorMessage(err) || t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [clearCache, config?.claudecode, fetchClaudeCodeModelOptions, getErrorMessage, isOpen, onBusyChange, t, updateConfigValue]);

  const saveClaudeCode = async () => {
    if (!loaded && mappingsDirty) {
      const confirmed = window.confirm(t('ai_providers.claudecode_mappings_overwrite_confirm'));
      if (!confirmed) return;
    }

    setSaving(true);
    setError('');
    try {
      const modelMappings = entriesToClaudeCodeMappings(form.mappingEntries);

      await claudecodeApi.updateForceModelMappings(form.forceModelMappings);

      if (loaded || mappingsDirty) {
        if (modelMappings.length) {
          await claudecodeApi.saveModelMappings(modelMappings);
        } else {
          await claudecodeApi.clearModelMappings();
        }
      }

      const next: ClaudeCodeConfig = {
        forceModelMappings: form.forceModelMappings,
      };

      if (loaded || mappingsDirty) {
        if (modelMappings.length) {
          next.modelMappings = modelMappings;
        } else {
          delete next.modelMappings;
        }
      }

      updateConfigValue('claudecode', next);
      clearCache('claudecode');
      showNotification(t('notification.claudecode_updated'), 'success');
      onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t('ai_providers.claudecode_modal_title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={saveClaudeCode} loading={saving} disabled={disableControls || loading}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}

      <div className="form-group">
        <ToggleSwitch
          label={t('ai_providers.claudecode_force_model_mappings_label')}
          checked={form.forceModelMappings}
          onChange={(value) => setForm((prev) => ({ ...prev, forceModelMappings: value }))}
          disabled={loading || saving}
        />
        <div className="hint">{t('ai_providers.claudecode_force_model_mappings_hint')}</div>
      </div>

      <div className="form-group">
        <label>{t('ai_providers.claudecode_model_mappings_label')}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input className="input" readOnly value={modelEndpoint} placeholder={t('ai_providers.claudecode_models_fetch_url_placeholder')} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchClaudeCodeModelOptions({ allowFallback: true })}
            loading={modelOptionsLoading}
            disabled={loading || saving}
          >
            {t('ai_providers.claudecode_models_fetch_refresh')}
          </Button>
        </div>
        <ModelInputList
          entries={form.mappingEntries}
          onChange={(entries) => {
            setMappingsDirty(true);
            setForm((prev) => ({ ...prev, mappingEntries: entries }));
          }}
          addLabel={t('ai_providers.claudecode_model_mappings_add_btn')}
          namePlaceholder={t('ai_providers.claudecode_model_mappings_from_placeholder')}
          aliasPlaceholder={t('ai_providers.claudecode_model_mappings_to_placeholder')}
          aliasInputMode="select"
          aliasOptions={mergedModelOptions}
          aliasEmptyOptionLabel={t('ai_providers.claudecode_model_mappings_to_select_placeholder')}
          showThinkingBudgetSelect
          thinkingBudgetOptions={thinkingBudgetOptions}
          thinkingBudgetPlaceholder={t('ai_providers.claudecode_model_mappings_thinking_placeholder')}
          disabled={loading || saving}
        />
        {modelOptionsError ? (
          <div className="hint" style={{ color: 'var(--danger-color)' }}>
            {modelOptionsError}
          </div>
        ) : modelOptionsLoading ? (
          <div className="hint">{t('ai_providers.claudecode_models_fetch_loading')}</div>
        ) : modelOptions.length === 0 ? (
          <div className="hint">{t('ai_providers.claudecode_models_fetch_empty')}</div>
        ) : null}
        <div className="hint">{t('ai_providers.claudecode_model_mappings_hint')}</div>
        <div className="hint">{t('ai_providers.claudecode_model_mappings_thinking_hint')}</div>
      </div>
    </Modal>
  );
}
