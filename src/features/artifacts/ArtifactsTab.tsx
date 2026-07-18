import { createEffect, createSignal, For, Show } from 'solid-js';
import CodeView from '../../shared/ui/CodeView';
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

export default function ArtifactsTab(props: { sessionId?: string; requestedPath?: string; refreshTrigger: number }) {
  const [artifacts, setArtifacts] = createSignal<ArtifactInfo[]>([]);
  const [selectedPath, setSelectedPath] = createSignal('');
  const [content, setContent] = createSignal<ArtifactContent>();
  const [loadingList, setLoadingList] = createSignal(false);
  const [loadingContent, setLoadingContent] = createSignal(false);
  const [error, setError] = createSignal('');
  let listSequence = 0;
  let contentSequence = 0;

  createEffect(() => {
    const sessionId = props.sessionId;
    void props.refreshTrigger;
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

  return (
    <div class="artifacts-tab">
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
                    <div class="artifact-markdown message-content" innerHTML={renderMarkdown(value().content)} />
                  </Show>
                  <Show when={isImage()}>
                    <div class="artifact-media"><img src={dataUrl(value())} alt={artifact.name}/></div>
                  </Show>
                  <Show when={isPdf()}>
                    <iframe class="artifact-pdf" src={dataUrl(value())} title={artifact.name}/>
                  </Show>
                  <Show when={isText() && !isMarkdown()}>
                    <CodeView code={value().content} path={artifact.path} class="artifact-code"/>
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
