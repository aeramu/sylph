import { createSignal, Show, For, onMount } from 'solid-js';

export interface UiRequest {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title?: string;
  body?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export default function UiRequestModal(props: { request: UiRequest; onRespond: (response: any) => void }) {
  const [textValue, setTextValue] = createSignal(props.request.prefill || '');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let cardRef: HTMLDivElement | undefined;
  let inputFieldRef: HTMLInputElement | undefined;
  let editorFieldRef: HTMLTextAreaElement | undefined;

  const respond = (response: any) => props.onRespond(response);

  const displayTitle = () => props.request.title || 'Permission Request';
  const displayBody = () => props.request.body || props.request.message;
  const isPermissionRequest = () => /permission/i.test(displayTitle());
  const selectOptions = () => props.request.options || [];
  const submitSelected = () => {
    const option = selectOptions()[selectedIndex()];
    if (option) respond({ id: props.request.id, value: option });
  };

  onMount(() => {
    if (props.request.method === 'input') {
      inputFieldRef?.focus();
    } else if (props.request.method === 'editor') {
      editorFieldRef?.focus();
    } else {
      cardRef?.focus();
    }
  });

  return (
    <div
      ref={cardRef}
      class="ui-request-card"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          respond({ id: props.request.id, cancelled: true });
          return;
        }
        const method = props.request.method;
        if (method === 'confirm' && e.key === 'Enter') {
          e.preventDefault();
          respond({ id: props.request.id, confirmed: true });
          return;
        }
        if (method !== 'select') return;
        const options = selectOptions();
        if (options.length === 0) return;
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % options.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          submitSelected();
        }
      }}
    >
      <div class="ui-request-header">
        <div class="ui-request-icon">?</div>
        <div>
          <h3 class="ui-request-title">{displayTitle()}</h3>
          <div class="ui-request-subtitle">The agent is waiting for your choice before continuing.</div>
        </div>
      </div>
      <Show when={displayBody()}>
        <pre class="ui-request-body">{displayBody()}</pre>
      </Show>

      <Show when={props.request.method === 'select'}>
        <div class="ui-request-options">
          <For each={selectOptions()}>
            {(option, index) => {
              const isDeny = option === 'No' || option.startsWith('No,');
              const isApprove = option === 'Yes' || option.startsWith('Yes,');
              return (
                <button
                  class={`ui-request-option ${index() === selectedIndex() ? 'selected' : ''} ${isApprove ? 'approve' : ''} ${isDeny ? 'deny' : ''}`}
                  onClick={() => setSelectedIndex(index())}
                  onDblClick={() => respond({ id: props.request.id, value: option })}
                >
                  <span class="ui-request-option-index">{index() + 1}</span>
                  <span>{option}</span>
                </button>
              );
            }}
          </For>
        </div>
        <div class="ui-request-actions">
          <button class="ui-request-btn" onClick={() => respond({ id: props.request.id, cancelled: true })}>{isPermissionRequest() ? 'Deny' : 'Skip'}</button>
          <button class="ui-request-btn approve" onClick={submitSelected}>Submit ↵</button>
        </div>
      </Show>

      <Show when={props.request.method === 'confirm'}>
        <div class="ui-request-actions">
          <button class="ui-request-btn approve" onClick={() => respond({ id: props.request.id, confirmed: true })}>Confirm</button>
          <button class="ui-request-btn" onClick={() => respond({ id: props.request.id, confirmed: false })}>Cancel</button>
        </div>
      </Show>

      <Show when={props.request.method === 'input'}>
        <input
          ref={inputFieldRef}
          class="ui-request-text"
          type="text"
          placeholder={props.request.placeholder || ''}
          value={textValue()}
          onInput={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') respond({ id: props.request.id, value: textValue() }); }}
          autofocus
        />
        <div class="ui-request-actions">
          <button class="ui-request-btn approve" onClick={() => respond({ id: props.request.id, value: textValue() })}>Submit</button>
          <button class="ui-request-btn" onClick={() => respond({ id: props.request.id, cancelled: true })}>Cancel</button>
        </div>
      </Show>

      <Show when={props.request.method === 'editor'}>
        <textarea
          ref={editorFieldRef}
          class="ui-request-textarea"
          value={textValue()}
          onInput={(e) => setTextValue(e.target.value)}
          rows={8}
          autofocus
        />
        <div class="ui-request-actions">
          <button class="ui-request-btn approve" onClick={() => respond({ id: props.request.id, value: textValue() })}>Submit</button>
          <button class="ui-request-btn" onClick={() => respond({ id: props.request.id, cancelled: true })}>Cancel</button>
        </div>
      </Show>
    </div>
  );
}
