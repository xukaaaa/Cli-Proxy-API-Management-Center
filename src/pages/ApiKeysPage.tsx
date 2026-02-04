import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { QuotaStatusDisplay } from '@/components/quotaManagement/QuotaStatusDisplay';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiKeysApi, quotaManagementApi, modelsApi } from '@/services/api';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import { validatePolicy } from '@/utils/quotaManagement';
import type { QuotaPolicy, QuotaUsage } from '@/types/quotaManagement';
import styles from './ApiKeysPage.module.scss';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // Quota-related state
  const [policies, setPolicies] = useState<Record<string, QuotaPolicy>>({});
  const [usageData, setUsageData] = useState<Record<string, QuotaUsage>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [quotaFormData, setQuotaFormData] = useState<Partial<QuotaPolicy>>({});
  const [showQuotaSection, setShowQuotaSection] = useState(false);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);

  const loadApiKeys = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        // Load API keys first
        const result = (await fetchConfig('api-keys', force)) as string[] | undefined;
        const list = Array.isArray(result) ? result : [];
        setApiKeys(list);

        // Load policies from config (backend returns "api-key-policies" in raw)
        const policiesConfig = config?.apiKeyPolicies || config?.raw?.['api-key-policies'] || {};
        console.log('Loading policies from config:', policiesConfig);
        setPolicies(policiesConfig);

        // Load quota usage and models in parallel (non-blocking)
        // Use first API key for models API call if available
        const firstApiKey = list.length > 0 ? list[0] : undefined;

        Promise.allSettled([
          quotaManagementApi.listUsage(),
          firstApiKey ? modelsApi.fetchModelsViaApiCall(apiBase, firstApiKey) : Promise.resolve([])
        ]).then(([usageResult, modelsResult]) => {
          // Process usage
          if (usageResult.status === 'fulfilled') {
            setUsageData(usageResult.value.usage || {});
          } else {
            console.warn('Failed to load usage:', usageResult.reason);
          }

          // Process models
          if (modelsResult.status === 'fulfilled') {
            const models = modelsResult.value;
            if (Array.isArray(models) && models.length > 0) {
              const modelNames = models.map((m: any) => {
                if (typeof m === 'string') return m;
                return m.id || m.name || String(m);
              }).filter(Boolean);
              console.log('Loaded models:', modelNames.length, 'models');
              setAvailableModels(modelNames);
            } else {
              console.log('No models returned from API');
            }
          } else {
            console.warn('Failed to load models (401 or other error) - models dropdown will be empty');
            // Don't show error to user, just leave models empty
          }
        });
      } catch (err: any) {
        setError(err?.message || t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    },
    [fetchConfig, apiBase, config, t]
  );

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  useEffect(() => {
    if (Array.isArray(config?.apiKeys)) {
      setApiKeys(config.apiKeys);
    }
  }, [config?.apiKeys]);

  // Sync policies from config
  useEffect(() => {
    // Backend returns "api-key-policies" (kebab-case), not "apiKeyPolicies" (camelCase)
    const policiesFromConfig = config?.apiKeyPolicies || config?.raw?.['api-key-policies'] || {};
    console.log('Syncing policies from config:', policiesFromConfig);
    setPolicies(policiesFromConfig);
  }, [config?.apiKeyPolicies, config?.raw]);

  const openAddModal = () => {
    setEditingIndex(null);
    setInputValue('');
    setQuotaFormData({});
    setShowQuotaSection(false);
    setModalOpen(true);
  };

  const openEditModal = async (index: number) => {
    setEditingIndex(index);
    const key = apiKeys[index] ?? '';
    setInputValue(key);

    // Try to load existing policy from state first
    let existingPolicy = policies[key];

    // If not in state, fetch from API
    if (!existingPolicy && key) {
      try {
        const response = await quotaManagementApi.getPolicy(key);
        existingPolicy = response.policy;
        // Update state with fetched policy
        setPolicies(prev => ({ ...prev, [key]: existingPolicy! }));
      } catch (err) {
        console.log('No existing policy for this key');
      }
    }

    if (existingPolicy) {
      console.log('Loading existing policy:', existingPolicy);
      setQuotaFormData(existingPolicy);
      setShowQuotaSection(true);
    } else {
      setQuotaFormData({});
      setShowQuotaSection(false);
    }

    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setEditingIndex(null);
    setQuotaFormData({});
    setShowQuotaSection(false);
  };

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      showNotification(`${t('notification.please_enter')} ${t('notification.api_key')}`, 'error');
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      showNotification(t('notification.api_key_invalid_chars'), 'error');
      return;
    }

    // Validate quota policy if quota section is shown
    if (showQuotaSection) {
      const validationError = validatePolicy(quotaFormData);
      if (validationError) {
        showNotification(validationError, 'error');
        return;
      }
    }

    const isEdit = editingIndex !== null;
    const nextKeys = isEdit
      ? apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key))
      : [...apiKeys, trimmed];

    setSaving(true);
    try {
      // Save API key
      if (isEdit && editingIndex !== null) {
        await apiKeysApi.update(editingIndex, trimmed);
        showNotification(t('notification.api_key_updated'), 'success');
      } else {
        await apiKeysApi.replace(nextKeys);
        showNotification(t('notification.api_key_added'), 'success');
      }

      // Save quota policy if provided
      if (showQuotaSection && Object.keys(quotaFormData).length > 0) {
        try {
          await quotaManagementApi.createOrUpdatePolicy(trimmed, quotaFormData as QuotaPolicy);
          showNotification(t('api_keys.policy_saved'), 'success');
        } catch (err: any) {
          showNotification(`Policy save failed: ${err?.message || ''}`, 'error');
        }
      }

      setApiKeys(nextKeys);
      updateConfigValue('api-keys', nextKeys);
      clearCache('api-keys');

      // Reload to get updated quota data
      await loadApiKeys(true);

      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!window.confirm(t('api_keys.delete_confirm'))) return;
    setDeletingIndex(index);
    const keyToDelete = apiKeys[index];
    try {
      await apiKeysApi.delete(index);
      const nextKeys = apiKeys.filter((_, idx) => idx !== index);
      setApiKeys(nextKeys);
      updateConfigValue('api-keys', nextKeys);
      clearCache('api-keys');

      // Also delete quota policy if exists
      if (policies[keyToDelete]) {
        try {
          await quotaManagementApi.deletePolicy(keyToDelete);
        } catch (err) {
          // Ignore policy deletion errors
        }
      }

      showNotification(t('notification.api_key_deleted'), 'success');

      // Reload to get updated quota data
      await loadApiKeys(true);
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setDeletingIndex(null);
    }
  };

  const handleDeletePolicy = async (apiKey: string) => {
    if (!window.confirm(t('api_keys.delete_policy_confirm'))) return;
    try {
      await quotaManagementApi.deletePolicy(apiKey);
      showNotification(t('api_keys.policy_deleted'), 'success');
      await loadApiKeys(true);
    } catch (err: any) {
      showNotification(`Policy delete failed: ${err?.message || ''}`, 'error');
    }
  };

  const handleAddPolicy = async (apiKey: string) => {
    const index = apiKeys.indexOf(apiKey);
    if (index !== -1) {
      await openEditModal(index);
      setShowQuotaSection(true);
    }
  };

  const handleEditPolicy = async (apiKey: string) => {
    const index = apiKeys.indexOf(apiKey);
    if (index !== -1) {
      await openEditModal(index);
    }
  };

  const actionButtons = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="sm" onClick={() => loadApiKeys(true)} disabled={loading}>
        {t('common.refresh')}
      </Button>
      <Button size="sm" onClick={openAddModal} disabled={disableControls}>
        {t('api_keys.add_button')}
      </Button>
    </div>
  );

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('api_keys.title')}</h1>

      <Card title={t('api_keys.proxy_auth_title')} extra={actionButtons}>
        {error && <div className="error-box">{error}</div>}

        {loading ? (
          <div className="flex-center" style={{ padding: '24px 0' }}>
            <LoadingSpinner size={28} />
          </div>
        ) : apiKeys.length === 0 ? (
          <EmptyState
            title={t('api_keys.empty_title')}
            description={t('api_keys.empty_desc')}
            action={
              <Button onClick={openAddModal} disabled={disableControls}>
                {t('api_keys.add_button')}
              </Button>
            }
          />
        ) : (
          <div className="item-list">
            {apiKeys.map((key, index) => (
              <div key={index} className="item-row">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '16px' }}>
                  <div className="item-meta">
                    <div className="pill">#{index + 1}</div>
                    <div className="item-title">{t('api_keys.item_title')}</div>
                    <div className="item-subtitle">{maskApiKey(String(key || ''))}</div>
                  </div>
                  <div className="item-actions">
                    <Button variant="secondary" size="sm" onClick={() => openEditModal(index)} disabled={disableControls}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(index)}
                      disabled={disableControls || deletingIndex === index}
                      loading={deletingIndex === index}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>

                {/* Quota Status Display - Full width */}
                <QuotaStatusDisplay
                  apiKey={key}
                  policy={policies[key]}
                  usage={usageData[key]}
                  onEditPolicy={() => handleEditPolicy(key)}
                  onDeletePolicy={() => handleDeletePolicy(key)}
                  onAddPolicy={() => handleAddPolicy(key)}
                />
              </div>
            ))}
          </div>
        )}

        <Modal
          open={modalOpen}
          onClose={closeModal}
          title={editingIndex !== null ? t('api_keys.edit_modal_title') : t('api_keys.add_modal_title')}
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSave} loading={saving}>
                {editingIndex !== null ? t('common.update') : t('common.add')}
              </Button>
            </>
          }
        >
          <Input
            label={
              editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_label')
            }
            placeholder={
              editingIndex !== null
                ? t('api_keys.edit_modal_key_label')
                : t('api_keys.add_modal_key_placeholder')
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={saving}
          />

          {/* Quota Policy Section */}
          <div className={styles.quotaSectionToggle} onClick={() => setShowQuotaSection(!showQuotaSection)}>
            <input type="checkbox" checked={showQuotaSection} onChange={() => {}} />
            <span>{t('api_keys.quota_section_title')}</span>
          </div>

          {showQuotaSection && (
            <div className={styles.quotaFields}>
              <Input
                label={t('api_keys.policy_name')}
                placeholder={t('api_keys.policy_name_placeholder')}
                value={quotaFormData.name || ''}
                onChange={(e) => setQuotaFormData({ ...quotaFormData, name: e.target.value })}
                disabled={saving}
              />

              <MultiSelect
                label={t('api_keys.allowed_models')}
                options={availableModels}
                value={quotaFormData.allowed_models || []}
                onChange={(selected) => setQuotaFormData({ ...quotaFormData, allowed_models: selected })}
                placeholder={t('api_keys.allowed_models_placeholder')}
                disabled={saving}
              />

              <div className={styles.fieldRow}>
                <Input
                  label={t('api_keys.max_tokens')}
                  type="number"
                  placeholder={t('api_keys.max_tokens_placeholder')}
                  value={quotaFormData.max_tokens?.toString() || ''}
                  onChange={(e) =>
                    setQuotaFormData({
                      ...quotaFormData,
                      max_tokens: e.target.value ? parseInt(e.target.value, 10) : undefined
                    })
                  }
                  disabled={saving}
                />

                <Input
                  label={t('api_keys.max_cost')}
                  type="number"
                  step="0.01"
                  placeholder={t('api_keys.max_cost_placeholder')}
                  value={quotaFormData.max_cost_usd?.toString() || ''}
                  onChange={(e) =>
                    setQuotaFormData({
                      ...quotaFormData,
                      max_cost_usd: e.target.value ? parseFloat(e.target.value) : undefined
                    })
                  }
                  disabled={saving}
                />
              </div>

              <Input
                label={t('api_keys.expires_at')}
                type="date"
                placeholder={t('api_keys.expires_at_placeholder')}
                value={quotaFormData.expires_at || ''}
                onChange={(e) => setQuotaFormData({ ...quotaFormData, expires_at: e.target.value })}
                disabled={saving}
              />
            </div>
          )}
        </Modal>
      </Card>
    </div>
  );
}
