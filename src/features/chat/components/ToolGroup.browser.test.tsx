import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import type { ChatMessage, ToolCall } from '../../../types';
import ToolGroup from '../ToolGroup';
import MessageTimeline from './MessageTimeline';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; });

it('expands calls on demand and collapses with a failure count when work finishes', async () => {
  const [tools, setTools] = createSignal<ToolCall[]>([{ name: 'read', status: 'running' }]);
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <ToolGroup items={tools().map(tool => ({ kind: 'tool' as const, tool }))} />, host);
  const working = page.getByRole('button', { name: 'Working 1 tool call' });
  await expect.element(working).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(working);
  await expect.element(page.getByText('read', { exact: true })).toBeInTheDocument();
  setTools([{ name: 'read', status: 'success' }, { name: 'bash', status: 'error' }]);
  const worked = page.getByRole('button', { name: 'Worked 2 tool calls 1 failed' });
  await expect.element(worked).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(worked);
  await expect.element(page.getByText('bash', { exact: true })).toBeInTheDocument();
});

it('groups across messages without resetting disclosure and splits at commentary', async () => {
  const first: ChatMessage = { id: 'a', role: 'assistant', content: 'Checking', tools: [{ name: 'read', status: 'success' }] };
  const [messages, setMessages] = createSignal<ChatMessage[]>([first]);
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <MessageTimeline messages={messages()} processing={false}
    onScroll={() => {}} onImageClick={() => {}} turnChipFor={() => null}
    onOpenTurn={() => {}} areaRef={() => {}} endRef={() => {}} />, host);
  await userEvent.click(page.getByRole('button', { name: 'Worked 1 tool call' }));
  setMessages([first, { id: 'b', role: 'assistant', content: '', tools: [{ name: 'bash', status: 'running' }] }]);
  await expect.element(page.getByRole('button', { name: 'Working 2 tool calls' })).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByText('Checking', { exact: true })).toBeInTheDocument();
  setMessages(current => [...current, { id: 'c', role: 'assistant', content: 'Next step', tools: [{ name: 'write', status: 'success' }] }]);
  await expect.element(page.getByRole('button', { name: 'Worked 1 tool call' })).toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: 'Working 2 tool calls' })).toBeInTheDocument();
});

it('keeps a lone thought outside work, then groups sequential thoughts and tools in order', async () => {
  const first: ChatMessage = { id: 'thought-a', role: 'assistant', content: '', thinking: 'First reasoning' };
  const [messages, setMessages] = createSignal<ChatMessage[]>([first]);
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <MessageTimeline messages={messages()} processing={false}
    onScroll={() => {}} onImageClick={() => {}} turnChipFor={() => null}
    onOpenTurn={() => {}} areaRef={() => {}} endRef={() => {}} />, host);
  await expect.element(page.getByText('Thought', { exact: true })).toBeInTheDocument();
  expect(host.querySelector('.tool-group')).toBeNull();
  setMessages([first,
    { id: 'call', role: 'assistant', content: '', tools: [{ name: 'read', status: 'success' }] },
    { id: 'thought-b', role: 'assistant', content: '', thinking: 'More reasoning', isThinking: true },
  ]);
  const working = page.getByRole('button', { name: 'Working 1 tool call · 2 thoughts' });
  await userEvent.click(working);
  expect(Array.from(host.querySelector('.tool-group-details')!.children).map(node => node.className))
    .toEqual(['thinking-block ', 'tool-execution', 'thinking-block active']);
  setMessages(current => [...current.slice(0, 2), { ...current[2], isThinking: false, content: 'Answer' }]);
  await expect.element(page.getByRole('button', { name: 'Worked 1 tool call · 2 thoughts' })).toHaveAttribute('aria-expanded', 'false');
  await expect.element(page.getByText('Answer', { exact: true })).toBeInTheDocument();
});
