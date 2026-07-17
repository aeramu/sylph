import { createSignal, createEffect, createMemo, Show, on, onCleanup, onMount } from 'solid-js';
import type { Attachment, CommandInfo, ContextInfo, FileMentionInfo, ModelOption, ThinkingLevel, ThinkingLevelOption } from '../../types';
import { ACCEPT_ATTR } from '../../lib/attachments';
import CustomSelect, { type CustomSelectApi } from '../../shared/ui/CustomSelect';
import ContextIndicator from './ContextIndicator';
import { escapeHtml } from '../../lib/html';
import { fuzzyScore } from '../../lib/fuzzyScore';
import { createMentionSearch, type ActiveMention } from '../../lib/mentionSearch';
import AttachmentList from './components/AttachmentList';
import AutocompletePopup from './components/AutocompletePopup';
import ThinkingSelector from './components/ThinkingSelector';
import { createAttachments } from './createAttachments';
import { createSpeechInput } from './createSpeechInput';
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
  directoryId?: string;
  sessionId?: string;
  draftKey: string;
  draftText: string;
  onDraftChange: (text: string) => void;
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
  const [input, setInput] = createSignal(props.draftText);
  const {
    attachments, isDragOver, addFiles, remove: removeAttachment, reset: resetAttachments, take: takeAttachments,
    handleFileInput, handlePaste, handleDrop, handleDragEnter, handleDragLeave,
  } = createAttachments();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [caretPos, setCaretPos] = createSignal<number | null>(null);
  const [activeMention, setActiveMention] = createSignal<ActiveMention | null>(null);
  // Input value the command popup was Escape-dismissed at; cleared as soon as
  // the text changes so the popup reappears on further typing.
  const [dismissedCommand, setDismissedCommand] = createSignal<string | null>(null);
  const {
    results: mentionResults,
    loading: isMentionLoading,
    clear: clearMentionResults,
    suppressNext: suppressNextMentionRequest,
  } = createMentionSearch(activeMention, () => props.projectId, () => props.sessionId, () => props.directoryId);
  let fileInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let highlightRef: HTMLDivElement | undefined;
  let commandListRef: HTMLDivElement | undefined;
  let thinkingSliderRef: HTMLDivElement | undefined;
  let thinkingSliderInputRef: HTMLInputElement | undefined;
  let modelSelectApi: CustomSelectApi | undefined;
  let skipNextMentionSync = false;

  const updateInput = (text: string) => {
    setInput(text);
    props.onDraftChange(text);
  };

  const speechInput = createSpeechInput({
    input,
    updateInput,
    updateTextarea: (text) => {
      if (!textareaRef) return;
      textareaRef.value = text;
      textareaRef.setSelectionRange(text.length, text.length);
    },
    focus: () => textareaRef?.focus(),
  });
  const { isListening, isStarting: isStartingVoice, error: voiceError, supported: voiceInputSupported, toggle: toggleVoiceInput, cancel: cancelVoiceInput } = speechInput;

  createEffect(on(
    () => props.draftKey,
    () => {
      cancelVoiceInput();
      speechInput.resetError();
      const text = props.draftText;
      setInput(text);
      resetAttachments();
      if (textareaRef) textareaRef.value = text;
    },
  ));

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
    cancelVoiceInput();
  });

  createEffect(() => {
    if (!isThinkingSliderOpen()) {
      setDraggedThinkingIndex(null);
      return;
    }
    requestAnimationFrame(() => thinkingSliderInputRef?.focus());
  });

  props.api?.({
    setText: (text) => {
      if (textareaRef) textareaRef.value = text;
      updateInput(text);
    },
    pasteText: (text) => {
      if (!textareaRef) return;
      const cur = textareaRef.value;
      const pos = textareaRef.selectionStart;
      const pasted = cur.slice(0, pos) + text + cur.slice(textareaRef.selectionEnd);
      textareaRef.value = pasted;
      updateInput(pasted);
      textareaRef.focus();
    },
    focus: () => textareaRef?.focus(),
    addFiles,
  });

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
  const highlightedInput = createMemo(() => highlightMentions(input()));
  // Keep native textarea text visible unless there is actually a mention to
  // highlight. Besides avoiding an unnecessary mirror for ordinary messages,
  // this keeps the browser's caret and glyphs on the same rendering surface —
  // particularly important on iOS, where textarea font metrics can differ
  // subtly from an identically styled div after a line wraps.
  const hasMentionHighlights = createMemo(() => /@\{[^}\n]+\}|(^|\s)@[^\s{}]+/.test(input()));

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
      updateInput('');
      setSelectedIndex(0);
      cmd.run();
      return;
    }
    // Replace the initial slash word with the completed command
    const text = input();
    const replaced = text.replace(/^\/\S*/, `/${cmd.name} `);
    updateInput(replaced);
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
    updateInput(replaced);
    if (options.keepOpen) {
      // Tab behaves like autocomplete: fill the text but keep the current
      // dropdown/results/selection alive. The keyup after Tab would otherwise
      // re-detect the completed mention, re-query, and reset navigation.
      skipNextMentionSync = true;
      suppressNextMentionRequest();
      setActiveMention({ query: file.path, start: mention.start, end: nextPos });
    } else {
      setSelectedIndex(0);
      clearMentionResults();
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
    if (isListening() || isStartingVoice()) cancelVoiceInput();
    // Intercept a bare built-in command (e.g. "/model") so it runs its action
    // instead of being sent to the agent.
    const builtin = builtinCommands.find(c => `/${c.name}` === input().trim());
    if (builtin) {
      updateInput('');
      builtin.run();
      return;
    }
    if (!input().trim() && attachments().length === 0) return;
    const text = input();
    const pending = takeAttachments();
    updateInput('');
    setActiveMention(null);
    clearMentionResults();
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
        clearMentionResults();
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
      <AttachmentList attachments={attachments()} onRemove={removeAttachment} />
      <AutocompletePopup
        mentions={filteredMentions()}
        commands={filteredCommands()}
        selectedIndex={selectedIndex()}
        mentionHeader={`Mentions ${!props.projectId ? '• No project selected' : isMentionLoading() ? '• Searching…' : ''}`}
        mentionEmpty={mentionEmptyText()}
        listRef={(element) => { commandListRef = element; }}
        onMention={(file) => applyMention(file, { trailingSpace: true, keepOpen: false })}
        onCommand={applyCommand}
      />
      <div class="input-field-shell">
        <div
          ref={highlightRef}
          class="input-highlight-layer"
          aria-hidden="true"
          innerHTML={highlightedInput()}
        />
        <textarea
          ref={textareaRef}
          class={`input-field ${hasMentionHighlights() ? 'has-highlight-layer' : ''}`}
          placeholder="Ask anything, @ to mention, / for actions"
          value={input()}
          onInput={(e) => {
            const text = e.currentTarget.value;
            const pos = e.currentTarget.selectionStart ?? text.length;
            updateInput(text);
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
      <Show when={voiceError()}>
        <div class="voice-input-status error" role="alert">{voiceError()}</div>
      </Show>
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
          <ThinkingSelector
            levels={props.thinkingLevels}
            selectedIndex={selectedThinkingIndex()}
            selectedLabel={selectedThinkingLabel()}
            open={isThinkingSliderOpen()}
            draggedIndex={draggedThinkingIndex()}
            containerRef={(element) => { thinkingSliderRef = element; }}
            inputRef={(element) => { thinkingSliderInputRef = element; }}
            onToggle={() => setIsThinkingSliderOpen((open) => !open)}
            onUpdate={updateThinkingSlider}
            onCommit={commitThinkingSlider}
            onClose={() => setIsThinkingSliderOpen(false)}
            onReturnFocus={() => requestAnimationFrame(() => textareaRef?.focus())}
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
          <Show when={isEmpty() || isListening() || isStartingVoice()} fallback={
            <button
              class="send-button"
              onClick={() => handleSubmit()}
              disabled={props.disabled || !props.isConnected}
              title={props.disabled ? "Respond to the request first" : "Send message"}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </button>
          }>
            <button
              class={`send-button microphone-button ${isListening() || isStartingVoice() ? 'listening' : ''}`}
              type="button"
              onClick={toggleVoiceInput}
              disabled={props.disabled || !props.isConnected || !voiceInputSupported()}
              title={!voiceInputSupported()
                ? "Voice input is not supported in this browser"
                : isListening() || isStartingVoice()
                  ? "Stop voice input"
                  : "Start voice input"}
              aria-label={isListening() || isStartingVoice() ? "Stop voice input" : "Start voice input"}
              aria-pressed={isListening() || isStartingVoice()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
              </svg>
              <Show when={isListening() || isStartingVoice()}>
                <span class="microphone-pulse" aria-hidden="true" />
              </Show>
            </button>
          </Show>
        </Show>
        </div>
      </div>
    </div>
  );
}
