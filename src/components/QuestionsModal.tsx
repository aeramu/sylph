import { createSignal, For, Show, onMount } from 'solid-js';
import { renderMarkdown } from '../lib/markdown';

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}
export interface Question {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}
export interface QuestionsRequest {
  id: string;
  questions: Question[];
  sessionId?: string;
  // True when the dialog was rebuilt from the session file after a server
  // restart (no live promise is waiting on it).
  reconstructed?: boolean;
}

// Fixed-size, CSS-drawn radio/checkbox so selected and unselected states are
// always identical in size (Unicode glyphs like ◉/○ are not).
function Indicator(p: { multi: boolean; on: boolean }) {
  return (
    <span
      style={`box-sizing:border-box;width:16px;height:16px;flex:none;margin-top:2px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${p.on ? 'rgba(124,108,240,1)' : 'rgba(150,150,150,.55)'};border-radius:${p.multi ? '5px' : '50%'};background:${p.multi && p.on ? 'rgba(124,108,240,1)' : 'transparent'};color:#fff;font-size:11px;line-height:1;`}
    >
      <Show when={p.on}>
        {p.multi ? '✓' : <span style="width:8px;height:8px;border-radius:50%;background:rgba(124,108,240,1);" />}
      </Show>
    </span>
  );
}

// Native renderer for sylph's ask_user_question tool. Multiple questions are
// shown one at a time via a tab strip; single questions render inline.
export default function QuestionsModal(props: { request: QuestionsRequest; onRespond: (r: any) => void }) {
  const qs = () => props.request.questions || [];
  const [selected, setSelected] = createSignal<string[][]>(qs().map(() => []));
  const [custom, setCustom] = createSignal<string[]>(qs().map(() => ''));
  const [customSelected, setCustomSelected] = createSignal<boolean[]>(qs().map(() => false));
  const [focusedOption, setFocusedOption] = createSignal<number[]>(qs().map(() => -1));
  const [activeTab, setActiveTab] = createSignal(0);
  let cardRef: HTMLDivElement | undefined;
  const customInputs: Array<HTMLTextAreaElement | undefined> = [];

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((prev) => {
      const next = prev.map((a) => [...a]);
      if (multi) {
        const i = next[qi].indexOf(label);
        if (i >= 0) next[qi].splice(i, 1);
        else next[qi].push(label);
      } else {
        next[qi] = next[qi][0] === label ? [] : [label];
        setCustomSelected((prev) => { const n = [...prev]; n[qi] = false; return n; });
      }
      return next;
    });
  };
  const setCustomAt = (qi: number, val: string) => {
    setCustom((prev) => { const n = [...prev]; n[qi] = val; return n; });
    setCustomSelected((prev) => { const n = [...prev]; n[qi] = val.trim().length > 0; return n; });
    // Treat custom text as its own selected answer. For single-select
    // questions, custom text replaces the predefined choice.
    if (val.trim() && !qs()[qi]?.multiSelect) {
      setSelected((prev) => { const n = prev.map((a) => [...a]); n[qi] = []; return n; });
    }
  };
  const setFocusedOptionAt = (qi: number, val: number) =>
    setFocusedOption((prev) => { const n = [...prev]; n[qi] = val; return n; });
  const selectCustomAt = (qi: number) => {
    if (!custom()[qi].trim()) return;
    setCustomSelected((prev) => { const n = [...prev]; n[qi] = true; return n; });
    if (!qs()[qi]?.multiSelect) {
      setSelected((prev) => { const n = prev.map((a) => [...a]); n[qi] = []; return n; });
    }
  };

  const isCustomSelected = (qi: number) => customSelected()[qi] && custom()[qi].trim().length > 0;
  const isAnswered = (qi: number) => selected()[qi].length > 0 || isCustomSelected(qi);
  const answeredCount = () => qs().filter((_, qi) => isAnswered(qi)).length;
  const allAnswered = () => answeredCount() === qs().length;
  const isLast = () => activeTab() === qs().length - 1;

  const submit = () => {
    if (!allAnswered()) return;
    const answers = qs().map((_, qi) => ({
      selected: selected()[qi],
      ...(isCustomSelected(qi) ? { customText: custom()[qi].trim() } : {}),
    }));
    props.onRespond({ id: props.request.id, cancelled: false, answers });
  };
  const cancel = () => props.onRespond({ id: props.request.id, cancelled: true });

  const goNextOrSubmit = () => {
    if (isLast()) submit();
    else {
      setActiveTab(activeTab() + 1);
      queueMicrotask(() => cardRef?.focus());
    }
  };

  const moveFocusedOption = (dir: 1 | -1) => {
    const qi = activeTab();
    const q = qs()[qi];
    if (!q) return;

    const multi = !!q.multiSelect;
    const optionCount = q.options.length + 1; // predefined options + custom answer
    const customIndex = q.options.length;
    const current = focusedOption()[qi] ?? -1;
    const next = current < 0 ? (dir === 1 ? 0 : optionCount - 1) : (current + dir + optionCount) % optionCount;
    setFocusedOptionAt(qi, next);

    if (next === customIndex) {
      queueMicrotask(() => {
        customInputs[qi]?.focus();
        selectCustomAt(qi);
      });
      return;
    }

    customInputs[qi]?.blur();
    cardRef?.focus();

    // For single-select questions, arrows directly change the answer. For
    // multi-select, arrows only move focus; Space toggles the focused option.
    if (!multi) {
      toggle(qi, q.options[next].label, false);
    }
  };

  const toggleFocusedMultiOption = () => {
    const qi = activeTab();
    const q = qs()[qi];
    if (!q?.multiSelect || !q.options.length) return;
    const index = focusedOption()[qi] ?? -1;
    const safeIndex = index < 0 ? 0 : index;
    if (safeIndex >= q.options.length) {
      customInputs[qi]?.focus();
      if (custom()[qi].trim()) {
        setCustomSelected((prev) => { const n = [...prev]; n[qi] = !n[qi]; return n; });
      }
      return;
    }
    setFocusedOptionAt(qi, safeIndex);
    toggle(qi, q.options[safeIndex].label, true);
  };

  onMount(() => cardRef?.focus());

  const renderQuestion = (qi: number) => {
    const q = qs()[qi];
    const multi = !!q.multiSelect;
    const hasCustom = () => isCustomSelected(qi);
    let customInput: HTMLTextAreaElement | undefined;
    return (
      <div style="margin-top:14px;">
        <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:8px;flex-wrap:wrap;">
          <span style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:6px;background:rgba(127,127,127,.18);opacity:.85;">{q.header}</span>
          <span style="font-weight:600;">{q.question}</span>
        </div>
        <div class="ui-request-options">
            <For each={q.options}>
              {(opt, index) => {
                const isSel = () => selected()[qi].includes(opt.label);
                const preview = () => (typeof opt.preview === 'string' && opt.preview.trim() ? opt.preview : undefined);
                return (
                  <div>
                    <button
                      class={`ui-request-option ${isSel() ? 'selected' : ''} ${focusedOption()[qi] === index() ? 'focused' : ''}`}
                      style="align-items:flex-start;width:100%;"
                      onMouseEnter={() => setFocusedOptionAt(qi, index())}
                      onFocus={() => setFocusedOptionAt(qi, index())}
                      onClick={() => { setFocusedOptionAt(qi, index()); toggle(qi, opt.label, multi); }}
                    >
                      <Indicator multi={multi} on={isSel()} />
                      <span style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;">
                        <span>{opt.label}</span>
                        <Show when={opt.description}>
                          <span style="opacity:.6;font-size:.82em;white-space:normal;text-align:left;">{opt.description}</span>
                        </Show>
                      </span>
                    </button>
                    <Show when={isSel() && preview()}>
                      <div
                        class="message-content"
                        style="margin:6px 0 8px;max-height:260px;overflow:auto;padding:8px 12px;border-radius:8px;background:rgba(127,127,127,.08);font-size:.9em;"
                        innerHTML={renderMarkdown(preview() || '')}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
            {/* Custom answer, styled as an option row (with its own indicator). */}
            <div
              class={`ui-request-option ${hasCustom() ? 'selected' : ''} ${focusedOption()[qi] === q.options.length ? 'focused' : ''}`}
              style="cursor:text;align-items:flex-start;"
              onMouseEnter={() => setFocusedOptionAt(qi, q.options.length)}
              onClick={() => { setFocusedOptionAt(qi, q.options.length); customInput?.focus(); selectCustomAt(qi); }}
            >
              <Indicator multi={multi} on={hasCustom()} />
              <textarea
                ref={(el) => { customInput = el; customInputs[qi] = el; }}
                rows={1}
                style="flex:1;min-width:0;resize:none;background:transparent;border:none;outline:none;color:inherit;font:inherit;padding:0;line-height:1.35;"
                placeholder="Type your own answer…"
                value={custom()[qi]}
                onFocus={() => { setFocusedOptionAt(qi, q.options.length); selectCustomAt(qi); }}
                onInput={(e) => setCustomAt(qi, e.currentTarget.value)}
              />
            </div>
          </div>
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      class="ui-request-card"
      tabIndex={0}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement | null;
        const isTextInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
        const isActionButton = !!target?.closest?.('.ui-request-actions');

        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocusedOption(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocusedOption(-1); }
        else if (e.key === ' ' && !isTextInput && !isActionButton) { e.preventDefault(); toggleFocusedMultiOption(); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        else if (e.key === 'Enter' && !e.shiftKey && !isActionButton) { e.preventDefault(); goNextOrSubmit(); }
      }}
    >
      <div class="ui-request-header">
        <div class="ui-request-icon">?</div>
        <div>
          <h3 class="ui-request-title">{qs().length > 1 ? 'A few questions' : 'A question'}</h3>
          <div class="ui-request-subtitle">The agent needs your input before continuing.</div>
        </div>
      </div>

      <Show when={qs().length > 1}>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
          <For each={qs()}>
            {(q, qi) => {
              const active = () => activeTab() === qi();
              return (
                <button
                  onClick={() => setActiveTab(qi())}
                  style={`display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;font-size:.8rem;cursor:pointer;border:1px solid ${active() ? 'rgba(124,108,240,.9)' : 'rgba(127,127,127,.25)'};background:${active() ? 'rgba(124,108,240,.18)' : 'transparent'};color:inherit;`}
                >
                  <span style={`width:6px;height:6px;border-radius:50%;background:${isAnswered(qi()) ? '#5bd18b' : 'rgba(127,127,127,.5)'};`} />
                  {q.header}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {renderQuestion(activeTab())}

      <div class="ui-request-actions" style="margin-top:16px;align-items:center;">
        <button class="ui-request-btn" onClick={cancel}>Chat about this</button>
        <Show when={qs().length > 1}>
          <span style="opacity:.55;font-size:.82em;margin-left:auto;margin-right:4px;">{answeredCount()}/{qs().length} answered</span>
        </Show>
        <Show when={isLast()} fallback={
          <button class="ui-request-btn approve" onClick={goNextOrSubmit}>Next →</button>
        }>
          <button class="ui-request-btn approve" disabled={!allAnswered()} onClick={submit}>Submit</button>
        </Show>
      </div>
    </div>
  );
}
