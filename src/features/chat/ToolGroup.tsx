import { createEffect, createSignal, For, Show } from 'solid-js';
import type { WorkItem } from '../../lib/toolGroups';
import ThinkingSection from './ThinkingSection';
import DisclosureChevron from '../../shared/ui/DisclosureChevron';
import BackgroundJobCard from './components/BackgroundJobCard';
import ToolExecution from './ToolExecution';
import './ToolGroup.css';

export default function ToolGroup(props: { items: WorkItem[]; sessionId?: string }) {
  const tools = () => props.items.flatMap(item => item.kind === 'tool' ? [item.tool] : []);
  const thoughts = () => props.items.filter(item => item.kind === 'thought').length;
  const running = () => props.items.some(item => item.kind === 'thought'
    ? item.message.isThinking : item.tool.status === 'running');
  const failures = () => tools().filter(tool => tool.status === 'error').length;
  const summary = () => [
    tools().length ? `${tools().length} ${tools().length === 1 ? 'tool call' : 'tool calls'}` : '',
    thoughts() ? `${thoughts()} ${thoughts() === 1 ? 'thought' : 'thoughts'}` : '',
  ].filter(Boolean).join(' · ');
  const loneThought = () => props.items.length === 1 && props.items[0].kind === 'thought'
    ? props.items[0].message : undefined;
  const [expanded, setExpanded] = createSignal(false);
  let wasRunning = running();
  createEffect(() => {
    if (wasRunning && !running()) setExpanded(false);
    wasRunning = running();
  });

  return <Show when={loneThought()} fallback={<div class="tool-group">
    <button class="tool-group-header" aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}>
      <span classList={{ 'tool-group-active': running() }}>{running() ? 'Working' : 'Worked'}</span>
      <span class="tool-group-count">{summary()}</span>
      <Show when={failures()}><span class="tool-group-errors">{failures()} failed</span></Show>
      <DisclosureChevron expanded={expanded()} />
    </button>
    <Show when={expanded()}>
      <div class="tool-group-details">
        <For each={props.items}>{item => item.kind === 'thought'
          ? <ThinkingSection text={item.message.thinking || ''} active={!!item.message.isThinking} />
          : item.tool.name === 'bg_run' && item.tool.backgroundJob
            ? <BackgroundJobCard jobs={[item.tool.backgroundJob]} sessionId={props.sessionId} embedded />
            : <ToolExecution tool={item.tool} />}</For>
      </div>
    </Show>
  </div>}>
    {thought => <ThinkingSection text={thought().thinking || ''} active={!!thought().isThinking} />}
  </Show>;
}
