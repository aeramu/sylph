import { For, Show, type JSX } from 'solid-js';
import type { ExtWidget } from '../../../types';
import { stripAnsi } from '../../../lib/markdown';
import QuestionsModal, { type QuestionsRequest } from '../QuestionsModal';
import UiRequestModal, { type UiRequest } from '../UiRequestModal';

export default function ExtensionUiHost(props: {
  widgets: Record<string, ExtWidget>;
  statuses: Record<string, string>;
  uiRequest?: UiRequest | null;
  questionsRequest?: QuestionsRequest | null;
  onRespond: (response: any) => void;
  children: JSX.Element;
}) {
  return <>
    <Show when={Object.keys(props.widgets).length > 0}><For each={Object.values(props.widgets)}>{(widget) =>
      <div class={`ext-widget ext-widget-${widget.placement || 'aboveEditor'}`}><For each={widget.lines}>{(line) => <div class="ext-widget-line">{line}</div>}</For></div>
    }</For></Show>
    <Show when={props.uiRequest} keyed>{(request) => <UiRequestModal request={request} onRespond={props.onRespond}/>}</Show>
    <Show when={props.questionsRequest} keyed>{(request) => <QuestionsModal request={request} onRespond={props.onRespond}/>}</Show>
    <div style={props.uiRequest || props.questionsRequest ? 'display: none;' : ''}>{props.children}</div>
    <Show when={Object.keys(props.statuses).length > 0}><div class="ext-status-entries">
      <For each={Object.keys(props.statuses)}>{(key) => <span class="ext-status-entry" title={key}>{stripAnsi(props.statuses[key])}</span>}</For>
    </div></Show>
  </>;
}
