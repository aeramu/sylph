import { createEffect, createSignal, For, Show } from 'solid-js';
import CodeView from '../../shared/ui/CodeView';
import type { ReviewCommentRequest } from '../../shared/ui/ReviewCommentPopover';
import { renderMarkdown } from '../../lib/markdown';
import { listArtifacts, readArtifact, type ArtifactContent, type ArtifactInfo } from './api';
import './ArtifactsTab.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dataUrl(content: ArtifactContent): string {
  if (content.encoding === 'base64') return `data:${content.mimeType};base64,${content.content}`;
  return `data:${content.mimeType};charset=utf-8,${encodeURIComponent(content.content)}`;
}

export default function ArtifactsTab(props: {
  sessionId?: string;
  requestedPath?: string;
  refreshTrigger: number;
  onComment?: (request: ReviewCommentRequest) => void;
}) {
  const [artifacts, setArtifacts] = createSignal<ArtifactInfo[]>([]);
  const [selectedPath, setSelectedPath] = createSignal('');
  const [content, setContent] = createSignal<ArtifactContent>();
  const [loadingList, setLoadingList] = createSignal(false);
  const [loadingContent, setLoadingContent] = createSignal(false);
  const [manualRefresh, setManualRefresh] = createSignal(0);
  const [markdownSelection, setMarkdownSelection] = createSignal<{ quote: string; anchor: ReviewCommentRequest['anchor'] }>();
  const [error, setError] = createSignal('');
  let listSequence = 0;
  let contentSequence = 0;

  createEffect(() => {
    const sessionId = props.sessionId;
    void props.refreshTrigger;
    void manualRefresh();
    const sequence = ++listSequence;
    if (!sessionId) {
      setArtifacts([]);
      setSelectedPath('');
      setContent(undefined);
      return;
    }
    setLoadingList(true);
    setError('');
    void listArtifacts(sessionId).then((files) => {
      if (sequence !== listSequence) return;
      setArtifacts(files);
      setSelectedPath((current) => {
        if (current && files.some((file) => file.path === current)) return current;
        return files[0]?.path ?? '';
      });
    }).catch((cause) => {
      if (sequence === listSequence) setError(cause instanceof Error ? cause.message : 'Could not list artifacts.');
    }).finally(() => {
      if (sequence === listSequence) setLoadingList(false);
    });
  });

  createEffect(() => {
    const requested = props.requestedPath;
    void props.refreshTrigger;
    if (requested) setSelectedPath(requested);
  });

  createEffect(() => {
    const sessionId = props.sessionId;
    const path = selectedPath();
    // Reload selected content as well as metadata when the parent detects a
    // file mutation or the user explicitly asks for the latest artifact.
    void props.refreshTrigger;
    void manualRefresh();
    const sequence = ++contentSequence;
    setContent(undefined);
    if (!sessionId || !path) return;
    setLoadingContent(true);
    setError('');
    void readArtifact(sessionId, path).then((value) => {
      if (sequence === contentSequence) setContent(value);
    }).catch((cause) => {
      if (sequence === contentSequence) setError(cause instanceof Error ? cause.message : 'Could not read artifact.');
    }).finally(() => {
      if (sequence === contentSequence) setLoadingContent(false);
    });
  });

  const selectedInfo = () => artifacts().find((artifact) => artifact.path === selectedPath());
  const isMarkdown = () => content()?.mimeType === 'text/markdown';
  const isImage = () => !!content()?.mimeType.startsWith('image/');
  const isPdf = () => content()?.mimeType === 'application/pdf';
  const isText = () => content()?.encoding === 'utf8';

  const captureMarkdownSelection = () => {
    const selection = window.getSelection();
    const quote = selection?.toString().trim();
    if (!selection || !quote || selection.rangeCount === 0) { setMarkdownSelection(undefined); return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setMarkdownSelection({ quote, anchor: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } });
  };

  const commentMarkdownSelection = () => {
    const artifact = selectedInfo();
    const selection = markdownSelection();
    if (!artifact || !selection || !props.onComment) return;
    props.onComment({ surface: 'artifact', path: artifact.path, ...selection });
    setMarkdownSelection(undefined);
  };

  return (
    <div class="artifacts-tab">
      <div class="artifacts-toolbar">
        <span class="artifacts-toolbar-title">Artifacts</span>
        <button
          class={`artifacts-refresh ${loadingList() || loadingContent() ? 'loading' : ''}`}
          type="button"
          onClick={() => setManualRefresh((value) => value + 1)}
          disabled={!props.sessionId}
          title="Refresh artifacts"
          aria-label="Refresh artifacts"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
      <Show when={artifacts().length > 0} fallback={
        <div class="artifacts-empty">{loadingList() ? 'Loading artifacts…' : error() || 'No artifacts in this session yet.'}</div>
      }>
        <div class="artifacts-list" aria-label="Session artifacts">
          <For each={artifacts()}>{(artifact) =>
            <button class={`artifact-list-item ${selectedPath() === artifact.path ? 'active' : ''}`} onClick={() => setSelectedPath(artifact.path)} title={artifact.path}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span class="artifact-list-path">{artifact.path}</span>
              <span class="artifact-list-size">{formatSize(artifact.size)}</span>
            </button>
          }</For>
        </div>

        <Show when={selectedInfo()} keyed>{(artifact) =>
          <div class="artifact-viewer">
            <div class="artifact-viewer-header">
              <div class="artifact-viewer-heading">
                <strong title={artifact.path}>{artifact.name}</strong>
                <span>{artifact.path} · {formatSize(artifact.size)}</span>
              </div>
              <Show when={content()}>{(value) =>
                <a class="artifact-download" href={dataUrl(value())} download={artifact.name} title="Download artifact">Download</a>
              }</Show>
            </div>
            <Show when={!loadingContent()} fallback={<div class="artifact-state">Loading artifact…</div>}>
              <Show when={content()} fallback={<div class="artifact-state artifact-error">{error() || 'Artifact could not be loaded.'}</div>}>
                {(value) => <>
                  <Show when={isMarkdown()}>
                    <div class="artifact-markdown-review" onMouseUp={captureMarkdownSelection} onKeyUp={captureMarkdownSelection}>
                      <div class="artifact-markdown message-content" innerHTML={renderMarkdown(value().content)} />
                      {props.onComment && markdownSelection() && <button type="button" class="review-selection-button" onMouseDown={(event) => event.preventDefault()} onClick={commentMarkdownSelection}>Comment on selection</button>}
                    </div>
                  </Show>
                  <Show when={isImage()}>
                    <div class="artifact-media"><img src={dataUrl(value())} alt={artifact.name}/></div>
                  </Show>
                  <Show when={isPdf()}>
                    <iframe class="artifact-pdf" src={dataUrl(value())} title={artifact.name}/>
                  </Show>
                  <Show when={isText() && !isMarkdown()}>
                    <CodeView
                      code={value().content}
                      path={artifact.path}
                      class="artifact-code"
                      onComment={props.onComment ? (request) => props.onComment?.({
                        surface: 'artifact', path: artifact.path, ...request.selection, anchor: request.anchor,
                      }) : undefined}
                    />
                  </Show>
                  <Show when={!isText() && !isImage() && !isPdf()}>
                    <div class="artifact-state">Preview unavailable for {value().mimeType}. Download the file to open it.</div>
                  </Show>
                </>}
              </Show>
            </Show>
          </div>
        }</Show>
      </Show>
    </div>
  );
}
