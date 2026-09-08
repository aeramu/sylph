import { createEffect, createResource, createSignal, Show } from 'solid-js';
import type { ModelOption } from '../../../types';
import CustomSelect from '../../../shared/ui/CustomSelect';
import { getSettings, updateSettings } from '../api';

export default function PermissionsSettings(props: { models: ModelOption[] }) {
  const [settings] = createResource(getSettings);
  const [model, setModel] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  createEffect(() => { if (settings()) setModel(settings()!.permissionReviewModel || ''); });
  const save = async (value: string) => {
    const previous = model();
    setModel(value);
    setBusy(true);
    setMessage('');
    try {
      const saved = await updateSettings({ permissionReviewModel: value });
      setModel(saved.permissionReviewModel);
      setMessage('Approval model saved');
    } catch (error) {
      setModel(previous);
      setMessage(error instanceof Error ? error.message : 'Unable to save approval model');
    } finally { setBusy(false); }
  };
  return (
    <div class="settings-git-page">
      <section class="settings-settings-card">
        <div class="settings-settings-card-heading">
          <div><h3>AI approval model</h3><p>Used by Auto approve to review commands and actions independently of the chat model. If no model is selected, a review fails, or safety is uncertain, Sylph asks you.</p></div>
        </div>
        <CustomSelect
          triggerClass="settings-model-selector"
          value={model()}
          onChange={(value) => void save(value)}
          options={props.models}
          placeholder="Select an approval model"
          position="bottom"
          searchable
          searchPlaceholder="Search models..."
          noOptionsText="No configured models found"
          disabled={busy() || settings.loading || !!settings.error}
          groupBy={(option) => option.provider}
        />
        <Show when={settings.error}><div role="alert">Unable to load permission settings.</div></Show>
        <Show when={message()}><div class="settings-provider-message" role="status">{message()}</div></Show>
      </section>
      <section class="settings-settings-card">
        <div class="settings-settings-card-heading"><div><h3>Permission modes</h3>
          <p>Read only blocks changes. Ask for approval allows safe workspace actions and asks before risky or external actions. Auto approve delegates safety review to the selected model. Relaxed allows all actions except recognized catastrophic commands.</p>
        </div></div>
      </section>
    </div>
  );
}
