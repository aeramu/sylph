import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown links', () => {
  it('opens clickable links in a new tab without exposing the opener', () => {
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown('[Example](https://example.com)');

    const link = container.querySelector('a');
    expect(link?.href).toBe('https://example.com/');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });
});
