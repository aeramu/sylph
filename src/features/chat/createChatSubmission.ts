import type { Attachment } from '../../types';

export function prepareChatSubmission(userMessage: string, attachments: Attachment[]) {
  const messageImages = attachments
    .filter((attachment) => attachment.kind === 'image' && attachment.previewUrl)
    .map((attachment) => ({ url: attachment.previewUrl!, mimeType: attachment.mimeType }));
  const images = attachments
    .filter((attachment) => attachment.kind === 'image' && attachment.data)
    .map((attachment) => ({ type: 'image' as const, data: attachment.data!, mimeType: attachment.mimeType }));
  const fileTexts = attachments.filter((attachment) => attachment.kind === 'file' && attachment.text);
  let prompt = userMessage;
  if (fileTexts.length) {
    const inlined = fileTexts.map((file) => `<file name="${file.name}">\n${file.text}\n</file>`).join('\n\n');
    prompt = prompt ? `${prompt}\n\n${inlined}` : inlined;
  }
  return { userMessage, messageImages: messageImages.length ? messageImages : undefined, images: images.length ? images : undefined, prompt };
}
