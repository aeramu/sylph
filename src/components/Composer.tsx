import { createSignal, createEffect, createMemo, For, Show } from 'solid-js';
import type { Attachment, CommandInfo, ModelOption } from '../types';
import { ACCEPT_ATTR, readFile } from '../lib/attachments';
import CustomSelect from './CustomSelect';

// Imperative surface the extension UI bridge needs (setEditorText / pasteToEditor).
export interface ComposerApi {
  setText: (text: string) => void;
  pasteText: (text: string) => void;
  focus: () => void;
}

export default function Composer(props: {
  isConnected: boolean;
  isProcessing: boolean;
  disabled: boolean;
  commands: CommandInfo[];
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  api?: (api: ComposerApi) => void;
}) {
  const [input, setInput] = createSignal('');
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let fileInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let dragCounter = 0;

  props.api?.({
    setText: (text) => {
      if (textareaRef) textareaRef.value = text;
      setInput(text);
    },
    pasteText: (text) => {
      if (!textareaRef) return;
      const cur = textareaRef.value;
      const pos = textareaRef.selectionStart;
      const pasted = cur.slice(0, pos) + text + cur.slice(textareaRef.selectionEnd);
      textareaRef.value = pasted;
      setInput(pasted);
      textareaRef.focus();
    },
    focus: () => textareaRef?.focus(),
  });

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const read = await Promise.all(files.map(readFile));
    const valid = read.filter((a): a is Attachment => !!a);
    if (valid.length) setAttachments((prev) => [...prev, ...valid]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) addFiles(input.files);
    input.value = '';
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = 0;
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) setIsDragOver(false);
  };

  const filteredCommands = createMemo(() => {
    const text = input();
    const match = text.match(/^\/([^\s]*)$/);
    if (!match) return null;

    const query = match[1].toLowerCase();
    const matches = props.commands.filter(cmd =>
      cmd.name.toLowerCase().includes(query)
    );

    return matches.length > 0 ? matches : null;
  });

  createEffect(() => {
    // Reset selected index when filtered list changes
    filteredCommands();
    setSelectedIndex(0);
  });

  const applyCommand = (cmd: { name: string }) => {
    // Replace the initial slash word with the completed command
    const text = input();
    const replaced = text.replace(/^\/\S*/, `/${cmd.name} `);
    setInput(replaced);
    setSelectedIndex(0);
  };

  const handleSubmit = (e?: Event) => {
    e?.preventDefault();
    if (!input().trim() && attachments().length === 0) return;
    const text = input();
    const pending = attachments();
    setInput('');
    setAttachments([]);
    props.onSubmit(text, pending);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const commands = filteredCommands();

    if (commands) {
      // In a drop-up, ArrowUp moves visually UP (away from input) -> higher index
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % commands.length);
        return;
      }
      // ArrowDown moves visually DOWN (towards input) -> lower index
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length);
        return;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        applyCommand(commands[selectedIndex()]);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isEmpty = () => !input().trim() && attachments().length === 0;

  return (
    <div class={`input-area relative ${isDragOver() ? 'drag-over' : ''}`} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}>
      <Show when={attachments().length > 0}>
        <div class="attachment-previews">
          <For each={attachments()}>
            {(att) => (
              <div class={`attachment-chip ${att.kind === 'image' ? 'is-image' : 'is-file'}`}>
                <Show when={att.kind === 'image' && att.previewUrl} fallback={
                  <span class="attachment-file-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  </span>
                }>
                  <img src={att.previewUrl} alt={att.name} class="attachment-thumb" />
                </Show>
                <span class="attachment-chip-name" title={att.name}>{att.name}</span>
                <button class="attachment-chip-remove" onClick={() => removeAttachment(att.id)} title="Remove">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      {filteredCommands() && (
        <div class="autocomplete-popup">
          <div class="autocomplete-header">
            Slash Commands
          </div>
          <div class="autocomplete-list">
            <For each={[...filteredCommands()!].reverse()}>
              {(cmd, index) => {
                const originalIndex = () => filteredCommands()!.length - 1 - index();
                return (
                  <div
                    class={`autocomplete-item ${originalIndex() === selectedIndex() ? 'selected' : ''}`}
                    onClick={() => applyCommand(cmd)}
                  >
                    <div class="autocomplete-item-title">
                      <span class="autocomplete-item-name">/{cmd.name}</span>
                      <span class="autocomplete-item-source">{cmd.source}</span>
                    </div>
                    {cmd.description && <span class="autocomplete-item-desc">{cmd.description}</span>}
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        class="input-field"
        placeholder="Ask anything, @ to mention, / for actions"
        value={input()}
        onInput={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        rows={1}
        disabled={!props.isConnected || props.disabled}
      />
      <div class="input-toolbar">
        <div class="input-toolbar-left">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            style="display: none;"
            onChange={handleFileInput}
          />
          <button class="input-toolbar-btn" title="Add image or file" disabled={props.disabled} onClick={() => fileInputRef?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <CustomSelect
            triggerClass="model-selector"
            value={props.selectedModel}
            onChange={(val) => props.onSelectModel(val)}
            options={props.models}
            placeholder="Default model"
            position="top"
          />
        </div>

        <Show when={props.isProcessing}>
          <button
            class="stop-button"
            onClick={() => props.onStop()}
            title="Stop generation"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
          </button>
        </Show>
        <Show when={!props.isProcessing}>
          <button
            class="send-button"
            onClick={() => handleSubmit()}
            disabled={props.disabled || isEmpty() || !props.isConnected}
            title={props.disabled ? "Respond to the request first" : "Send message"}
            style={isEmpty() ? "background: transparent; box-shadow: none; color: var(--text-secondary);" : ""}
          >
            <Show when={isEmpty()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
              </svg>
            </Show>
            <Show when={!isEmpty()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </Show>
          </button>
        </Show>
      </div>
    </div>
  );
}
