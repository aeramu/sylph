import { createSignal } from 'solid-js';
import type { Attachment } from '../../types';
import { readFile } from '../../lib/attachments';

export function createAttachments() {
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  let dragCounter = 0;

  const addFiles = async (fileList: FileList | File[]) => {
    const read = await Promise.all(Array.from(fileList).map(readFile));
    const valid = read.filter((attachment): attachment is Attachment => !!attachment);
    if (valid.length) setAttachments((previous) => [...previous, ...valid]);
  };
  const remove = (id: string) => setAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
  const reset = () => setAttachments([]);
  const take = () => { const pending = attachments(); reset(); return pending; };
  const handleFileInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) void addFiles(input.files);
    input.value = '';
  };
  const handlePaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => !!file);
    if (files.length) { event.preventDefault(); void addFiles(files); }
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); dragCounter = 0; setIsDragOver(false);
    if (event.dataTransfer?.files?.length) void addFiles(event.dataTransfer.files);
  };
  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer?.types?.includes('Files')) { dragCounter++; setIsDragOver(true); }
  };
  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); dragCounter = Math.max(0, dragCounter - 1);
    if (!dragCounter) setIsDragOver(false);
  };
  return { attachments, isDragOver, addFiles, remove, reset, take, handleFileInput, handlePaste, handleDrop, handleDragEnter, handleDragLeave };
}
