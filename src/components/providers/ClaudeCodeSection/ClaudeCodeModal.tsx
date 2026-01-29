import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useConfigStore, useNotificationStore } from '@/stores';
import { claudecodeApi } from '@/services/api';
import type { ClaudeCodeConfig } from '@/types';
import { buildClaudeCodeFormState, entriesToClaudeCodeMappings } from '../utils';
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

  const [form, setForm] = useState<ClaudeCodeFormState>(() => buildClaudeCodeFormState(null));
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mappingsDirty, setMappingsDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  useEffect(() => {
    onBusyChange?.(loading || saving);
  }, [loading, saving, onBusyChange]);

  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
      setLoading(false);
      setSaving(false);
      setError('');
      setLoaded(false);
      setMappingsDirty(false);
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
    setForm(buildClaudeCodeFormState(config?.claudecode ?? null));

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
  }, [clearCache, config?.claudecode, isOpen, onBusyChange, t, updateConfigValue]);

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

      const previous = config?.claudecode ?? {};
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
        <ModelInputList
          entries={form.mappingEntries}
          onChange={(entries) => {
            setMappingsDirty(true);
            setForm((prev) => ({ ...prev, mappingEntries: entries }));
          }}
          addLabel={t('ai_providers.claudecode_model_mappings_add_btn')}
          namePlaceholder={t('ai_providers.claudecode_model_mappings_from_placeholder')}
          aliasPlaceholder={t('ai_providers.claudecode_model_mappings_to_placeholder')}
          disabled={loading || saving}
        />
        <div className="hint">{t('ai_providers.claudecode_model_mappings_hint')}</div>
      </div>
    </Modal>
  );
}
