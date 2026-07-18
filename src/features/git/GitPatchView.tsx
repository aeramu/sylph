import { createMemo, createSignal, Index, Show } from 'solid-js';
import DiffView, { type DiffLineAction } from '../changes/DiffView';
import DisclosureChevron from '../../shared/ui/DisclosureChevron';
import {
  gitHunkView,
  makeHunkPatch,
  makeLinePatch,
  parseGitPatch,
} from '../../lib/gitPatch';

export default function GitPatchView(props: {
  patch: string;
  actionLabel: string;
  path: string;
  busy: boolean;
  reverse?: boolean;
  lineActionLabel: string;
  onApplyPatch: (patch: string) => void;
}) {
  const parsed = () => parseGitPatch(props.patch);
  const [collapsedHunks, setCollapsedHunks] = createSignal<Record<number, boolean>>({});

  return (
    <Show when={props.patch.trim()}>
      <div class="git-patch-block">
        <Index each={parsed().hunks}>
          {(hunk, hunkIndex) => {
            const view = createMemo(() => gitHunkView(hunk()));
            const action = (item: { line: number; patchLineIndex: number; sourceLine?: number; text: string }): DiffLineAction => ({
              line: item.line,
              label: props.reverse ? '−' : '+',
              title: `${props.lineActionLabel} ${item.sourceLine}: ${item.text}`,
              onClick: () => props.onApplyPatch(makeLinePatch(props.patch, hunk(), item.patchLineIndex, !!props.reverse)),
            });
            return (
              <div class="git-hunk">
                <div class="git-hunk-header">
                  <button
                    class="git-hunk-toggle"
                    onClick={() => setCollapsedHunks((value) => ({ ...value, [hunkIndex]: !value[hunkIndex] }))}
                    aria-expanded={!collapsedHunks()[hunkIndex]}
                    title={collapsedHunks()[hunkIndex] ? 'Expand hunk' : 'Collapse hunk'}
                  >
                    <DisclosureChevron expanded={!collapsedHunks()[hunkIndex]} class="git-chevron" />
                    <code>{hunk().header}</code>
                  </button>
                  <button
                    class="git-icon-button git-hunk-action"
                    disabled={props.busy}
                    onClick={() => props.onApplyPatch(makeHunkPatch(props.patch, hunk()))}
                    title={`${props.actionLabel} hunk`}
                    aria-label={`${props.actionLabel} hunk`}
                  >
                    {props.reverse ? '−' : '+'}
                  </button>
                </div>
                <Show when={!collapsedHunks()[hunkIndex]}>
                  <DiffView
                    oldText={view().oldText}
                    newText={view().newText}
                    path={props.path}
                    oldLineStart={hunk().oldStart}
                    newLineStart={hunk().newStart}
                    oldLineActions={view().oldActions.map(action)}
                    newLineActions={view().newActions.map(action)}
                  />
                </Show>
              </div>
            );
          }}
        </Index>
      </div>
    </Show>
  );
}
