import { For } from 'solid-js';
import { diffLines } from '../lib/diff';

export default function DiffView(props: { oldText: string; newText: string }) {
  const rows = diffLines(props.oldText, props.newText);
  return (
    <div class="diff-view">
      <For each={rows}>
        {(row) => (
          <div class="diff-row">
            <div class={`diff-cell diff-old ${row.type === 'del' ? 'removed' : ''}`}>{row.old ?? ''}</div>
            <div class={`diff-cell diff-new ${row.type === 'add' ? 'added' : ''}`}>{row.new ?? ''}</div>
          </div>
        )}
      </For>
    </div>
  );
}
