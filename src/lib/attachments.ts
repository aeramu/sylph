import type { Attachment } from '../types';

const TEXT_FILE_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.zsh', '.sql', '.csv', '.log', '.env', '.vue', '.svelte',
];
const MAX_TEXT_FILE_BYTES = 512 * 1024;

export const ACCEPT_ATTR = 'image/*,' + TEXT_FILE_EXTENSIONS.join(',');

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_FILE_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}

export function readFile(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const base = { id, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        resolve({ ...base, kind: 'image', data: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl, previewUrl: dataUrl });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else if (isTextFile(file) && file.size <= MAX_TEXT_FILE_BYTES) {
      const reader = new FileReader();
      reader.onload = () => resolve({ ...base, kind: 'file', text: reader.result as string });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    } else {
      resolve(null);
    }
  });
}
