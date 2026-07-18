import { For, Show } from 'solid-js';
import type { ChatMessage } from '../../../types';
import { hasRenderableContent } from '../../../lib/messages';
import DiffStats from '../../changes/DiffStats';
import MessageBubble from '../MessageBubble';
import ThinkingIndicator from './ThinkingIndicator';

export interface TurnChip { turn: number; files: number; added: number; deleted: number }

export default function MessageTimeline(props: {
  messages: readonly ChatMessage[];
  processing: boolean;
  onScroll: () => void;
  onImageClick: (url: string) => void;
  turnChipFor: (index: number) => TurnChip | null;
  onOpenTurn: (turn: number) => void;
  areaRef: (element: HTMLDivElement) => void;
  endRef: (element: HTMLDivElement) => void;
}) {
  return <div class="messages-area" ref={props.areaRef} onScroll={props.onScroll}>
    <For each={props.messages}>{(message, index) => <>
      <Show when={hasRenderableContent(message)}><MessageBubble msg={message} onImageClick={props.onImageClick}/></Show>
      <Show when={props.turnChipFor(index())} keyed>{(chip) => <div class="turn-diff-row">
        <button class="diff-stats-chip" onClick={() => props.onOpenTurn(chip.turn)} title={`Show file changes from turn ${chip.turn}`}>
          <DiffStats files={chip.files} added={chip.added} deleted={chip.deleted}/>
        </button>
      </div>}</Show>
    </>}</For>
    <Show when={props.processing && !props.messages.find((message) => message.isStreaming)}>
      <div class="message assistant"><div class="message-bubble"><ThinkingIndicator /></div></div>
    </Show>
    <div ref={props.endRef}/>
  </div>;
}
