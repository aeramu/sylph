import { createSignal, createEffect, createMemo, For, Show } from 'solid-js';
import type { Attachment, CommandInfo, ContextInfo, ModelOption, ThinkingLevel, ThinkingLevelOption } from '../types';
import { ACCEPT_ATTR, readFile } from '../lib/attachments';
import CustomSelect, { type CustomSelectApi } from './CustomSelect';
import ContextIndicator from './ContextIndicator';
import './Composer.css';

// Built-in slash commands handled locally by the composer (they run a UI
// action instead of being sent to the agent). Their `run` is filled in below.
interface BuiltinCommand extends CommandInfo { builtin: true; run: () => void }

// Subsequence fuzzy match: every char of `query` must appear in `target` in
// order (e.g. "9rourel" matches "9router-reload"). Returns a relevance score
// (higher is better), or null when it doesn't match. Both args must be
// lowercased by the caller.
//
// Uses a small DP to find the highest-scoring alignment rather than a greedy
// first-occurrence walk — greedy would match the "r" ending "router" and miss
// the much stronger contiguous "rel" at the "-reload" boundary.
function fuzzyScore(query: string, target: string): number | null {
  const n = query.length;
  const m = target.length;
  if (n === 0) return 0;
  if (n > m) return null;
  const NEG = -Infinity;

  const bonusAt = (ti: number, consecutive: boolean): number => {
    let b = 1;
    if (ti === 0) b += 8;                      // matches the very first char
    else {
      const p = target[ti - 1];
      if (p === '-' || p === '_' || p === '/' || p === ' ') b += 6; // word boundary
    }
    if (consecutive) b += 5;                   // adjacent to the previous match
    return b;
  };

  // prev[ti] = best score for query[0..qi] with query[qi] placed at target[ti].
  let prev = new Array<number>(m).fill(NEG);
  for (let ti = 0; ti <= m - n; ti++) {
    if (target[ti] === query[0]) prev[ti] = bonusAt(ti, false);
  }

  for (let qi = 1; qi < n; qi++) {
    const curr = new Array<number>(m).fill(NEG);
    let maxBeforePrev = NEG; // best prev[ti'] for ti' <= ti - 2 (non-adjacent)
    for (let ti = qi; ti <= m - n + qi; ti++) {
      if (ti - 2 >= 0 && prev[ti - 2] > maxBeforePrev) maxBeforePrev = prev[ti - 2];
      if (target[ti] !== query[qi]) continue;
      let best = NEG;
      if (prev[ti - 1] > NEG) best = prev[ti - 1] + bonusAt(ti, true);      // adjacent
      if (maxBeforePrev > NEG) best = Math.max(best, maxBeforePrev + bonusAt(ti, false));
      curr[ti] = best;
    }
    prev = curr;
  }

  let best = NEG;
  for (let ti = 0; ti < m; ti++) if (prev[ti] > best) best = prev[ti];
  if (best === NEG) return null;
  return best - target.length * 0.1; // gently prefer shorter, tighter matches
}

// Imperative surface the extension UI bridge needs (setEditorText / pasteToEditor).
export interface ComposerApi {
  setText: (text: string) => void;
  pasteText: (text: string) => void;
  focus: () => void;
  addFiles: (fileList: FileList | File[]) => Promise<void>;
}

export default function Composer(props: {
  isConnected: boolean;
  isProcessing: boolean;
  disabled: boolean;
  commands: CommandInfo[];
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  thinkingLevels: ThinkingLevelOption[];
  selectedThinkingLevel: ThinkingLevel;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  contextInfo?: ContextInfo | null;
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
  let commandListRef: HTMLDivElement | undefined;
  let modelSelectApi: CustomSelectApi | undefined;
  let dragCounter = 0;

  const builtinCommands: BuiltinCommand[] = [
    {
      name: 'model',
      source: 'built-in',
      description: 'Switch the active model',
      builtin: true,
      run: () => modelSelectApi?.open(),
    },
  ];
  const isBuiltin = (cmd: CommandInfo): cmd is BuiltinCommand => (cmd as BuiltinCommand).builtin === true;

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const read = await Promise.all(files.map(readFile));
    const valid = read.filter((a): a is Attachment => !!a);
    if (valid.length) setAttachments((prev) => [...prev, ...valid]);
  };

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
    addFiles,
  });

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
    e.stopPropagation();
    dragCounter = 0;
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) setIsDragOver(false);
  };

  const filteredCommands = createMemo(() => {
    const text = input();
    const match = text.match(/^\/([^\s]*)$/);
    if (!match) return null;

    const query = match[1].toLowerCase();
    const all: CommandInfo[] = [...builtinCommands, ...props.commands];
    if (query === '') return all.length > 0 ? all : null;

    const scored: { cmd: CommandInfo; score: number }[] = [];
    for (const cmd of all) {
      const score = fuzzyScore(query, cmd.name.toLowerCase());
      if (score !== null) scored.push({ cmd, score });
    }
    // Best match first; ties keep the original order (Array.sort is stable).
    scored.sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored.map(s => s.cmd) : null;
  });

  // Drop-up render order (best match nearest the input). Kept null-safe so the
  // reactive `each` below never spreads null during the truthy -> null
  // transition, which would throw and freeze the composer's reactivity.
  const reversedCommands = createMemo(() => {
    const cmds = filteredCommands();
    return cmds ? [...cmds].reverse() : [];
  });

  createEffect(() => {
    // Reset selected index when filtered list changes
    filteredCommands();
    setSelectedIndex(0);
  });

  createEffect(() => {
    // Keep the highlighted command visible: the drop-up list is reversed and
    // scrollable, so the default (index 0) sits at the bottom and arrow
    // navigation can move the selection out of the current scroll window.
    selectedIndex();
    filteredCommands();
    const list = commandListRef;
    if (!list) return;
    const el = list.querySelector('.autocomplete-item.selected') as HTMLElement | null;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (elRect.top < listRect.top) {
      list.scrollTop -= listRect.top - elRect.top;
    } else if (elRect.bottom > listRect.bottom) {
      list.scrollTop += elRect.bottom - listRect.bottom;
    }
  });

  const applyCommand = (cmd: CommandInfo) => {
    // Built-in commands run a local UI action and clear the input rather than
    // completing the text or being sent to the agent.
    if (isBuiltin(cmd)) {
      setInput('');
      setSelectedIndex(0);
      cmd.run();
      return;
    }
    // Replace the initial slash word with the completed command
    const text = input();
    const replaced = text.replace(/^\/\S*/, `/${cmd.name} `);
    setInput(replaced);
    setSelectedIndex(0);
  };

  const handleSubmit = (e?: Event) => {
    e?.preventDefault();
    // Intercept a bare built-in command (e.g. "/model") so it runs its action
    // instead of being sent to the agent.
    const builtin = builtinCommands.find(c => `/${c.name}` === input().trim());
    if (builtin) {
      setInput('');
      builtin.run();
      return;
    }
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
      <Show when={filteredCommands()}>
        <div class="autocomplete-popup">
          <div class="autocomplete-header">
            Slash Commands
          </div>
          <div class="autocomplete-list" ref={commandListRef}>
            <For each={reversedCommands()}>
              {(cmd, index) => {
                const originalIndex = () => reversedCommands().length - 1 - index();
                return (
                  <div
                    class={`autocomplete-item ${originalIndex() === selectedIndex() ? 'selected' : ''}`}
                    // Keep focus in the textarea: without this, mousedown blurs
                    // the field and the reflow can swallow the click so the
                    // command is never applied and the popup stays open.
                    onMouseDown={(e) => e.preventDefault()}
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
      </Show>
      <textarea
        ref={textareaRef}
        class="input-field"
        placeholder="Ask anything, @ to mention, / for actions"
        value={input()}
        onInput={(e) => setInput(e.currentTarget.value)}
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
            onChange={(val) => {
              props.onSelectModel(val);
              // Return focus to the composer after picking a model (rAF so it
              // runs once the dropdown has closed and the DOM has reconciled).
              requestAnimationFrame(() => textareaRef?.focus());
            }}
            options={props.models}
            placeholder="Default model"
            position="top"
            searchable
            searchPlaceholder="Search models..."
            noOptionsText="No models found"
            groupBy={(opt) => opt.provider}
            api={(a) => { modelSelectApi = a; }}
          />
          <CustomSelect
            triggerClass="thinking-selector"
            value={props.selectedThinkingLevel}
            onChange={(val) => props.onSelectThinkingLevel(val as ThinkingLevel)}
            options={props.thinkingLevels}
            placeholder="Thinking"
            position="top"
          />
        </div>

        <div class="input-toolbar-right">
        <ContextIndicator context={props.contextInfo ?? null} />
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
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Show>
          </button>
        </Show>
        </div>
      </div>
    </div>
  );
}
