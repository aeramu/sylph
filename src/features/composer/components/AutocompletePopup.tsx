import { For, Show } from 'solid-js';
import type { CommandInfo, FileMentionInfo } from '../../../types';

export default function AutocompletePopup(props: {
  mentions: FileMentionInfo[] | null;
  commands: CommandInfo[] | null;
  selectedIndex: number;
  mentionHeader: string;
  mentionEmpty: string;
  listRef: (element: HTMLDivElement) => void;
  onMention: (mention: FileMentionInfo) => void;
  onCommand: (command: CommandInfo) => void;
}) {
  const reversedMentions = () => props.mentions ? [...props.mentions].reverse() : [];
  const reversedCommands = () => props.commands ? [...props.commands].reverse() : [];
  return <>
    <Show when={props.mentions}><div class="autocomplete-popup"><div class="autocomplete-header">{props.mentionHeader}</div><div class="autocomplete-list" ref={props.listRef}>
      <Show when={reversedMentions().length > 0} fallback={<div class="autocomplete-empty">{props.mentionEmpty}</div>}><For each={reversedMentions()}>{(file, index) => {
        const originalIndex = () => reversedMentions().length - 1 - index();
        return <div class={`autocomplete-item ${originalIndex() === props.selectedIndex ? 'selected' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onMention(file)}>
          <div class="autocomplete-item-title"><span class="autocomplete-item-name">{file.kind === 'directory' ? '📁' : '📄'} {file.path}</span><span class="autocomplete-item-source">{file.kind}</span></div>
        </div>;
      }}</For></Show>
    </div></div></Show>
    <Show when={props.commands}><div class="autocomplete-popup"><div class="autocomplete-header">Slash Commands</div><div class="autocomplete-list" ref={props.listRef}>
      <For each={reversedCommands()}>{(command, index) => {
        const originalIndex = () => reversedCommands().length - 1 - index();
        return <div class={`autocomplete-item ${originalIndex() === props.selectedIndex ? 'selected' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onCommand(command)}>
          <div class="autocomplete-item-title"><span class="autocomplete-item-name">/{command.name}</span><span class="autocomplete-item-source">{command.source}</span></div>
          <Show when={command.description}><span class="autocomplete-item-desc">{command.description}</span></Show>
        </div>;
      }}</For>
    </div></div></Show>
  </>;
}
