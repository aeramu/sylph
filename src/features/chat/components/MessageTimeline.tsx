import { createMemo, For, Show } from 'solid-js';
import type { ChatMessage } from '../../../types';
import { groupToolMessages } from '../../../lib/toolGroups';
import DiffStats from '../../changes/DiffStats';
import MessageBubble from '../MessageBubble';
import ToolGroup from '../ToolGroup';
import ThinkingIndicator from './ThinkingIndicator';

export interface TurnChip { turn: number; files: number; added: number; deleted: number }

export default function MessageTimeline(props: {
  messages: readonly ChatMessage[];
  processing: boolean;
  sessionId?: string;
  onScroll: () => void;
  onImageClick: (url: string) => void;
  turnChipFor: (index: number) => TurnChip | null;
  onOpenTurn: (turn: number) => void;
  areaRef: (element: HTMLDivElement) => void;
  endRef: (element: HTMLDivElement) => void;
}) {
  const groups = createMemo(() => new Map(groupToolMessages(props.messages, index => !!props.turnChipFor(index))
    .map(group => [group.id, group])));
  const groupIds = createMemo(() => [...groups().keys()]);
  return <div class="messages-area" ref={props.areaRef} onScroll={props.onScroll}>
    <For each={groupIds()}>{id => {
      const group = () => groups().get(id)!;
      const message = () => { const row = group(); return row.kind === 'message' ? row.message : undefined; };
      const items = () => { const row = group(); return row.kind === 'work' ? row.items : []; };
      const chip = () => { const row = group(); return row.kind === 'turn' ? props.turnChipFor(row.index) : null; };
      return <>
        <Show when={message()}>{value => <MessageBubble msg={value()} sessionId={props.sessionId} onImageClick={props.onImageClick}/>}</Show>
        <Show when={items().length}><ToolGroup items={items()} sessionId={props.sessionId}/></Show>
        <Show when={chip()} keyed>{value => <div class="turn-diff-row">
          <button class="diff-stats-chip" onClick={() => props.onOpenTurn(value.turn)} title={`Show file changes from turn ${value.turn}`}>
            <DiffStats files={value.files} added={value.added} deleted={value.deleted}/>
          </button>
        </div>}</Show>
      </>;
    }}</For>
    <Show when={props.processing && !props.messages.find((message) => message.isStreaming)}>
      <div class="message assistant"><div class="message-bubble"><ThinkingIndicator /></div></div>
    </Show>
    <div ref={props.endRef}/>
  </div>;
}
