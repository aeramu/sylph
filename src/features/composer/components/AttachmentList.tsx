import { For, Show } from 'solid-js';
import type { Attachment } from '../../../types';

export default function AttachmentList(props: { attachments: Attachment[]; onRemove: (id: string) => void }) {
  return <Show when={props.attachments.length > 0}><div class="attachment-previews"><For each={props.attachments}>{(attachment) =>
    <div class={`attachment-chip ${attachment.kind === 'image' ? 'is-image' : 'is-file'}`}>
      <Show when={attachment.kind === 'image' && attachment.previewUrl} fallback={<span class="attachment-file-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>}>
        <img src={attachment.previewUrl} alt={attachment.name} class="attachment-thumb"/>
      </Show>
      <span class="attachment-chip-name" title={attachment.name}>{attachment.name}</span>
      <button class="attachment-chip-remove" onClick={() => props.onRemove(attachment.id)} title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  }</For></div></Show>;
}
