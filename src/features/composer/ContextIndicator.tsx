import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import type { ContextInfo } from '../../types';

// Compact "108.7k" / "1.0M" formatting used throughout the popover.
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function fmtPercent(p: number): string {
  return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

// Rounded ring button showing context-window fill, with a popover breaking
// down what the context is spent on. Sits to the left of the send/stop button.
export default function ContextIndicator(props: { context: ContextInfo | null }) {
  const [open, setOpen] = createSignal(false);
  // The section breakdown is an accordion collapsed by default; its trigger is
  // the header + progress bar.
  const [breakdownOpen, setBreakdownOpen] = createSignal(false);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const handleDocMouseDown = (e: MouseEvent) => {
    if (open() && rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => document.addEventListener('mousedown', handleDocMouseDown));
  onCleanup(() => document.removeEventListener('mousedown', handleDocMouseDown));

  const percent = () => props.context?.percent ?? null;
  const tokens = () => props.context?.tokens ?? null;

  const ringColor = () => {
    const p = percent();
    if (p === null) return 'var(--text-secondary)';
    if (p >= 90) return '#ef4444';
    if (p >= 75) return '#f59e0b';
    return 'var(--accent)';
  };

  // Sections shown in the breakdown. "Messages" is whatever the model-reported
  // context total doesn't attribute to the (estimated) system prompt and tools.
  const sections = () => {
    const ctx = props.context;
    if (!ctx || ctx.tokens === null) return null;
    const messages = Math.max(0, ctx.tokens - ctx.systemPromptTokens - ctx.toolTokens);
    const free = Math.max(0, ctx.contextWindow - ctx.tokens);
    const pct = (n: number) => (ctx.contextWindow > 0 ? (n / ctx.contextWindow) * 100 : 0);
    return [
      { label: 'Messages', tokens: messages, percent: pct(messages), color: 'var(--accent)' },
      { label: 'System prompt', tokens: ctx.systemPromptTokens, percent: pct(ctx.systemPromptTokens), color: '#818cf8' },
      { label: 'Tools', tokens: ctx.toolTokens, percent: pct(ctx.toolTokens), color: '#a5b4fc' },
      { label: 'Free space', tokens: free, percent: pct(free), color: 'rgba(255, 255, 255, 0.14)', free: true },
    ];
  };

  // 22px ring: r=9 → circumference ≈ 56.55
  const RADIUS = 9;
  const CIRC = 2 * Math.PI * RADIUS;

  return (
    <Show when={props.context}>
      <div class="context-indicator" ref={rootRef}>
        <button
          class="context-ring-btn"
          onClick={() => setOpen((v) => !v)}
          title={
            percent() !== null
              ? `Context window: ${fmtTokens(tokens()!)} / ${fmtTokens(props.context!.contextWindow)} (${fmtPercent(percent()!)})`
              : 'Context window usage unknown'
          }
          aria-label="Context window usage"
        >
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r={RADIUS} fill="none" stroke="rgba(255, 255, 255, 0.14)" stroke-width="2.5" />
            <circle
              cx="11" cy="11" r={RADIUS}
              fill="none"
              stroke={ringColor()}
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-dasharray={`${(Math.min(100, Math.max(percent() ?? 0, percent() !== null ? 1.5 : 0)) / 100) * CIRC} ${CIRC}`}
              transform="rotate(-90 11 11)"
            />
          </svg>
        </button>

        <Show when={open()}>
          <div class="context-popover">
            <button
              class="context-accordion-trigger"
              onClick={() => sections() && setBreakdownOpen((v) => !v)}
              disabled={!sections()}
            >
              <div class="context-popover-header">
                <span class="context-popover-title">Context window</span>
                <span class="context-popover-usage">
                  {tokens() !== null
                    ? `${fmtTokens(tokens()!)} / ${fmtTokens(props.context!.contextWindow)} (${fmtPercent(percent()!)})`
                    : `— / ${fmtTokens(props.context!.contextWindow)}`}
                </span>
              </div>

              <div class="context-bar-row">
                <div class="context-bar">
                  <Show when={sections()} fallback={<div class="context-bar-segment" style="width: 0%" />}>
                    {(secs) => (
                      <>
                        {secs().filter(s => !s.free && s.percent > 0).map((s) => (
                          <div class="context-bar-segment" style={`width: ${Math.max(0.75, s.percent)}%; background: ${s.color}`} />
                        ))}
                      </>
                    )}
                  </Show>
                </div>
                <Show when={sections()}>
                  <svg
                    class="context-accordion-chevron"
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                    style={`transform: rotate(${breakdownOpen() ? 90 : 0}deg); transition: transform 0.15s;`}
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </Show>
              </div>
            </button>

            <Show
              when={sections()}
              fallback={<div class="context-popover-empty">Usage is recalculated after the next response.</div>}
            >
              {(secs) => (
                <Show when={breakdownOpen()}>
                  <div class="context-rows">
                    {secs().map((s) => (
                      <div class={`context-row ${s.free ? 'is-free' : ''}`}>
                        <span class="context-row-dot" style={`background: ${s.color}`} />
                        <span class="context-row-label">{s.label}</span>
                        <span class="context-row-tokens">{fmtTokens(s.tokens)}</span>
                        <span class="context-row-percent">{fmtPercent(s.percent)}</span>
                      </div>
                    ))}
                  </div>
                </Show>
              )}
            </Show>

            <Show when={props.context!.stats}>
              {(stats) => (
                <div class="context-details">
                  <button class="context-details-toggle" onClick={() => setDetailsOpen((v) => !v)}>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                      style={`transform: rotate(${detailsOpen() ? 90 : 0}deg); transition: transform 0.15s;`}
                    >
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    Session details
                  </button>
                  <Show when={detailsOpen()}>
                    <div class="context-rows context-details-rows">
                      <div class="context-row"><span class="context-row-label">Messages</span><span class="context-row-tokens">{stats().totalMessages}</span></div>
                      <div class="context-row"><span class="context-row-label">Tool calls</span><span class="context-row-tokens">{stats().toolCalls}</span></div>
                      <div class="context-row"><span class="context-row-label">Input tokens</span><span class="context-row-tokens">{fmtTokens(stats().tokens.input)}</span></div>
                      <div class="context-row"><span class="context-row-label">Output tokens</span><span class="context-row-tokens">{fmtTokens(stats().tokens.output)}</span></div>
                      <div class="context-row"><span class="context-row-label">Cache read</span><span class="context-row-tokens">{fmtTokens(stats().tokens.cacheRead)}</span></div>
                      <div class="context-row"><span class="context-row-label">Cache write</span><span class="context-row-tokens">{fmtTokens(stats().tokens.cacheWrite)}</span></div>
                      <div class="context-row"><span class="context-row-label">Cost</span><span class="context-row-tokens">${stats().cost.toFixed(4)}</span></div>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
