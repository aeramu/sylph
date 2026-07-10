import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount } from 'solid-js';
import type { Attachment, CommandInfo, ContextInfo, FileMentionInfo, ModelOption, ThinkingLevel, ThinkingLevelOption } from '../types';
import { ACCEPT_ATTR, readFile } from '../lib/attachments';
import CustomSelect, { type CustomSelectApi } from './CustomSelect';
import ContextIndicator from './ContextIndicator';
import { escapeHtml } from '../lib/html';
import { fuzzyScore } from '../lib/fuzzyScore';
import './Composer.css';

// Built-in slash commands handled locally by the composer (they run a UI
// action instead of being sent to the agent). Their `run` is filled in below.
interface BuiltinCommand extends CommandInfo { builtin: true; run: () => void }

function highlightMentions(text: string): string {
  if (!text) return '';
  const pattern = /@\{[^}\n]+\}|(^|\s)@[^\s{}]+/g;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const raw = match[0];
    const leading = match[1] || '';
    let mention = leading ? raw.slice(leading.length) : raw;
    // A bare mention that ends a sentence ("@src/app.ts.") shouldn't highlight
    // the trailing punctuation — the server strips it before resolving, so the
    // highlight would otherwise overpromise what actually gets sent.
    if (!mention.startsWith('@{')) {
      const stripped = mention.replace(/[.,;:!?)\]}'"]+$/, '');
      if (stripped.length > 1) mention = stripped;
    }
    const mentionStart = match.index + leading.length;

    out += escapeHtml(text.slice(last, mentionStart));
    out += `<span class="input-mention-highlight">${escapeHtml(mention)}</span>`;
    last = mentionStart + mention.length;
  }

  out += escapeHtml(text.slice(last));
  // Preserve final blank lines in the mirror layer so caret/scroll alignment
  // doesn't collapse when the textarea ends with a newline.
  if (text.endsWith('\n')) out += ' ';
  return out;
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
  projectId?: string;
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
  const [caretPos, setCaretPos] = createSignal<number | null>(null);
  const [activeMention, setActiveMention] = createSignal<{ query: string; start: number; end: number } | null>(null);
  // Input value the command popup was Escape-dismissed at; cleared as soon as
  // the text changes so the popup reappears on further typing.
  const [dismissedCommand, setDismissedCommand] = createSignal<string | null>(null);
  const [mentionResults, setMentionResults] = createSignal<FileMentionInfo[]>([]);
  const [isMentionLoading, setIsMentionLoading] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let highlightRef: HTMLDivElement | undefined;
  let commandListRef: HTMLDivElement | undefined;
  let thinkingSliderRef: HTMLDivElement | undefined;
  let thinkingSliderInputRef: HTMLInputElement | undefined;
  let modelSelectApi: CustomSelectApi | undefined;
  let dragCounter = 0;
  let skipNextMentionSync = false;
  let suppressNextMentionFetch = false;

  const builtinCommands: BuiltinCommand[] = [
    {
      name: 'model',
      source: 'built-in',
      description: 'Switch the active model',
      builtin: true,
      run: () => modelSelectApi?.open(),
    },
    {
      name: 'thinking',
      source: 'built-in',
      description: 'Set the thinking level',
      builtin: true,
      run: () => setIsThinkingSliderOpen(true),
    },
  ];
  const isBuiltin = (cmd: CommandInfo): cmd is BuiltinCommand => (cmd as BuiltinCommand).builtin === true;

  const selectedThinkingIndex = () => {
    const index = props.thinkingLevels.findIndex((level) => level.value === props.selectedThinkingLevel);
    return index >= 0 ? index : 0;
  };

  const selectedThinkingLabel = () =>
    props.thinkingLevels.find((level) => level.value === props.selectedThinkingLevel)?.label
    || props.selectedThinkingLevel;

  const selectThinkingIndex = (index: number) => {
    const level = props.thinkingLevels[index];
    if (level) props.onSelectThinkingLevel(level.value);
  };

  const [draggedThinkingIndex, setDraggedThinkingIndex] = createSignal<number | null>(null);
  const displayedThinkingIndex = () => draggedThinkingIndex() ?? selectedThinkingIndex();

  const thinkingSliderProgress = (index = displayedThinkingIndex()) => {
    const lastIndex = Math.max(props.thinkingLevels.length - 1, 1);
    return (index / lastIndex) * 100;
  };

  const thinkingSliderPosition = (index = displayedThinkingIndex()) =>
    `${thinkingSliderProgress(index)}%`;

  const nearestThinkingIndex = (rawIndex: number) => {
    const lastIndex = Math.max(props.thinkingLevels.length - 1, 0);
    return Math.max(0, Math.min(lastIndex, Math.round(rawIndex)));
  };

  const updateThinkingSlider = (rawIndex: number) => {
    setDraggedThinkingIndex(rawIndex);
    const index = nearestThinkingIndex(rawIndex);
    if (index !== selectedThinkingIndex()) selectThinkingIndex(index);
  };

  const commitThinkingSlider = (rawIndex: number) => {
    selectThinkingIndex(nearestThinkingIndex(rawIndex));
    setDraggedThinkingIndex(null);
  };

  const [isThinkingSliderOpen, setIsThinkingSliderOpen] = createSignal(false);

  const handleThinkingSliderOutside = (e: MouseEvent) => {
    if (thinkingSliderRef && !thinkingSliderRef.contains(e.target as Node)) {
      setIsThinkingSliderOpen(false);
    }
  };

  const handleThinkingSliderKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setIsThinkingSliderOpen(false);
  };

  onMount(() => {
    document.addEventListener('mousedown', handleThinkingSliderOutside);
    document.addEventListener('keydown', handleThinkingSliderKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleThinkingSliderOutside);
    document.removeEventListener('keydown', handleThinkingSliderKeyDown);
  });

  createEffect(() => {
    if (!isThinkingSliderOpen()) {
      setDraggedThinkingIndex(null);
      return;
    }
    requestAnimationFrame(() => thinkingSliderInputRef?.focus());
  });

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

  const updateActiveMention = (text = input(), rawPos = textareaRef?.selectionStart ?? caretPos() ?? text.length) => {
    const pos = Math.min(rawPos, text.length);
    const before = text.slice(0, pos);
    const match = before.match(/(^|\s)@([^\s{}]*)$/);
    if (!match) {
      setActiveMention((prev) => prev === null ? prev : null);
      return;
    }

    const next = { query: match[2], start: pos - match[2].length - 1, end: pos };
    // Arrow-key navigation fires keyup/caret sync even though the mention did
    // not change. Returning the existing object prevents Solid from treating it
    // as a new mention, which would re-query /api/fs/files and reset selection.
    setActiveMention((prev) => (
      prev && prev.query === next.query && prev.start === next.start && prev.end === next.end
        ? prev
        : next
    ));
  };

  createEffect(() => {
    const mention = activeMention();
    const projectId = props.projectId;
    if (!mention || !projectId) {
      setMentionResults([]);
      setIsMentionLoading(false);
      return;
    }
    if (suppressNextMentionFetch) {
      suppressNextMentionFetch = false;
      return;
    }

    let cancelled = false;
    setIsMentionLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/fs/files?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(mention.query)}`);
        const data = await res.json();
        if (!cancelled) setMentionResults(res.ok ? (data.files || []) : []);
      } catch {
        if (!cancelled) setMentionResults([]);
      } finally {
        if (!cancelled) setIsMentionLoading(false);
      }
    }, 120);

    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });

  const filteredMentions = createMemo(() => activeMention() ? mentionResults() : null);

  const mentionEmptyText = () => {
    if (!props.projectId) return 'Select a project to mention files';
    if (isMentionLoading()) return 'Searching files…';
    return 'No matching files';
  };

  const filteredCommands = createMemo(() => {
    if (activeMention()) return null;
    const text = input();
    if (dismissedCommand() === text) return null;
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

  const reversedMentions = createMemo(() => {
    const files = filteredMentions();
    return files ? [...files].reverse() : [];
  });

  const highlightedInput = createMemo(() => highlightMentions(input()));

  createEffect(() => {
    // Reset selected index when filtered list changes
    filteredCommands();
    filteredMentions();
    setSelectedIndex(0);
  });

  createEffect(() => {
    // Keep the highlighted command visible: the drop-up list is reversed and
    // scrollable, so the default (index 0) sits at the bottom and arrow
    // navigation can move the selection out of the current scroll window.
    selectedIndex();
    filteredCommands();
    filteredMentions();
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

  const syncCaret = () => {
    if (!textareaRef) return;
    const pos = textareaRef.selectionStart ?? textareaRef.value.length;
    setCaretPos(pos);
    if (skipNextMentionSync) {
      skipNextMentionSync = false;
      return;
    }
    updateActiveMention(textareaRef.value, pos);
  };

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
    requestAnimationFrame(() => {
      if (!textareaRef) return;
      textareaRef.value = replaced;
      textareaRef.focus();
      textareaRef.setSelectionRange(replaced.length, replaced.length);
      syncCaret();
    });
  };

  const formatMention = (path: string) => {
    // Keep common paths readable in the textarea: @src/App.tsx.
    // Fall back to braced mentions only when the path needs an explicit
    // boundary, e.g. spaces: @{docs/my note.md}.
    return /[\s{}]/.test(path) ? `@{${path}}` : `@${path}`;
  };

  const applyMention = (file: FileMentionInfo, options: { trailingSpace: boolean; keepOpen: boolean }) => {
    const mention = activeMention();
    if (!mention || !textareaRef) return;
    const text = input();
    const inserted = `${formatMention(file.path)}${options.trailingSpace ? ' ' : ''}`;
    const replaced = text.slice(0, mention.start) + inserted + text.slice(mention.end);
    const nextPos = mention.start + inserted.length;
    textareaRef.value = replaced;
    setInput(replaced);
    if (options.keepOpen) {
      // Tab behaves like autocomplete: fill the text but keep the current
      // dropdown/results/selection alive. The keyup after Tab would otherwise
      // re-detect the completed mention, re-query, and reset navigation.
      skipNextMentionSync = true;
      suppressNextMentionFetch = true;
      setActiveMention({ query: file.path, start: mention.start, end: nextPos });
    } else {
      setSelectedIndex(0);
      setMentionResults([]);
      setActiveMention(null);
    }
    requestAnimationFrame(() => {
      textareaRef?.focus();
      textareaRef?.setSelectionRange(nextPos, nextPos);
      setCaretPos(nextPos);
    });
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
    setActiveMention(null);
    setMentionResults([]);
    setSelectedIndex(0);
    props.onSubmit(text, pending);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const levels = props.thinkingLevels;
      if (levels.length > 1) {
        const nextIndex = (selectedThinkingIndex() + 1) % levels.length;
        selectThinkingIndex(nextIndex);
      }
      return;
    }

    const mentions = filteredMentions();
    const commands = filteredCommands();

    if (mentions) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setActiveMention(null);
        setMentionResults([]);
        setSelectedIndex(0);
        return;
      }
      // Only intercept navigation/commit keys when there's something to pick.
      // With no results (still loading, or a mention like "@name" with no file
      // match) Enter must fall through to submit instead of being swallowed.
      if (mentions.length) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % mentions.length);
          return;
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + mentions.length) % mentions.length);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          applyMention(mentions[selectedIndex()], { trailingSpace: true, keepOpen: false });
          return;
        } else if (e.key === 'Tab') {
          e.preventDefault();
          applyMention(mentions[selectedIndex()], { trailingSpace: false, keepOpen: true });
          return;
        }
      }
    }

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
        // Close the popup but keep what the user typed, mirroring the mention
        // popup's Escape (which just closes without clearing the field).
        e.preventDefault();
        setDismissedCommand(input());
        setSelectedIndex(0);
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
      <Show when={filteredMentions()}>
        <div class="autocomplete-popup">
          <div class="autocomplete-header">
            Mentions {!props.projectId ? '• No project selected' : isMentionLoading() ? '• Searching…' : ''}
          </div>
          <div class="autocomplete-list" ref={commandListRef}>
            <Show when={reversedMentions().length > 0} fallback={<div class="autocomplete-empty">{mentionEmptyText()}</div>}>
              <For each={reversedMentions()}>
                {(file, index) => {
                  const originalIndex = () => reversedMentions().length - 1 - index();
                  return (
                    <div
                      class={`autocomplete-item ${originalIndex() === selectedIndex() ? 'selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyMention(file, { trailingSpace: true, keepOpen: false })}
                    >
                      <div class="autocomplete-item-title">
                        <span class="autocomplete-item-name">{file.kind === 'directory' ? '📁' : '📄'} {file.path}</span>
                        <span class="autocomplete-item-source">{file.kind}</span>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
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
      <div class="input-field-shell">
        <div
          ref={highlightRef}
          class="input-highlight-layer"
          aria-hidden="true"
          innerHTML={highlightedInput()}
        />
        <textarea
          ref={textareaRef}
          class={`input-field ${input() ? 'has-highlight-layer' : ''}`}
          placeholder="Ask anything, @ to mention, / for actions"
          value={input()}
          onInput={(e) => {
            const text = e.currentTarget.value;
            const pos = e.currentTarget.selectionStart ?? text.length;
            setInput(text);
            setCaretPos(pos);
            updateActiveMention(text, pos);
            if (highlightRef) highlightRef.scrollTop = e.currentTarget.scrollTop;
          }}
          onScroll={(e) => { if (highlightRef) highlightRef.scrollTop = e.currentTarget.scrollTop; }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onPaste={handlePaste}
          rows={1}
          disabled={!props.isConnected || props.disabled}
        />
      </div>
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
          <div class="thinking-slider" ref={thinkingSliderRef}>
            <button
              class="thinking-selector thinking-slider-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isThinkingSliderOpen()}
              title={`Thinking: ${selectedThinkingLabel()}`}
              disabled={props.thinkingLevels.length === 0}
              onClick={() => setIsThinkingSliderOpen((open) => !open)}
            >
              <span class="thinking-slider-trigger-value">{selectedThinkingLabel()}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={`custom-select-chevron ${isThinkingSliderOpen() ? 'open' : ''}`}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <Show when={isThinkingSliderOpen()}>
              <div class="thinking-slider-popover" role="dialog" aria-label="Thinking level">
                <div class="thinking-slider-popover-header">
                  <span>Thinking level</span>
                  <strong>{selectedThinkingLabel()}</strong>
                </div>
                <div class="thinking-slider-scale" aria-hidden="true">
                  <span>Faster</span>
                  <span>Smarter</span>
                </div>
                <div class="thinking-slider-control">
                  <div class="thinking-slider-track" aria-hidden="true">
                    <div class="thinking-slider-points">
                      <span
                        class="thinking-slider-fill"
                        style={`width: calc(${thinkingSliderPosition()} + 11px)`}
                      />
                      <For each={props.thinkingLevels}>
                        {(_, index) => (
                          <span
                            class="thinking-slider-dot"
                            style={`left: ${thinkingSliderPosition(index())}`}
                          />
                        )}
                      </For>
                      <span
                        class="thinking-slider-thumb"
                        style={`left: ${thinkingSliderPosition()}`}
                      />
                    </div>
                  </div>
                  <input
                    ref={thinkingSliderInputRef}
                    class="thinking-slider-input"
                    type="range"
                    min="0"
                    max={Math.max(props.thinkingLevels.length - 1, 0)}
                    step="any"
                    value={displayedThinkingIndex()}
                    aria-label="Thinking level"
                    aria-valuetext={selectedThinkingLabel()}
                    disabled={props.thinkingLevels.length < 2}
                    onInput={(e) => updateThinkingSlider(Number(e.currentTarget.value))}
                    onChange={(e) => commitThinkingSlider(Number(e.currentTarget.value))}
                    onKeyDown={(e) => {
                      const lastIndex = Math.max(props.thinkingLevels.length - 1, 0);
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        commitThinkingSlider(Math.round(displayedThinkingIndex()) - 1);
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        commitThinkingSlider(Math.round(displayedThinkingIndex()) + 1);
                      } else if (e.key === 'Home') {
                        e.preventDefault();
                        commitThinkingSlider(0);
                      } else if (e.key === 'End') {
                        e.preventDefault();
                        commitThinkingSlider(lastIndex);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        commitThinkingSlider(Number(e.currentTarget.value));
                        setIsThinkingSliderOpen(false);
                        requestAnimationFrame(() => textareaRef?.focus());
                      }
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>
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
