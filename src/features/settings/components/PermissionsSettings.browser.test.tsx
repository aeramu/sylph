import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import PermissionsSettings from './PermissionsSettings';
import { getSettings, updateSettings } from '../api';

vi.mock('../api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; vi.clearAllMocks(); });

it('saves the selected approval model and keeps it selected', async () => {
  vi.mocked(getSettings).mockResolvedValue({ permissionReviewModel: '', commitMessageModel: '', commitMessageThinkingLevel: 'off', commitMessagePrompt: '' });
  vi.mocked(updateSettings).mockResolvedValue({ permissionReviewModel: 'provider/reviewer', commitMessageModel: '', commitMessageThinkingLevel: 'off', commitMessagePrompt: '' });
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <PermissionsSettings models={[{ value: 'provider/reviewer', label: 'Reviewer', provider: 'provider' }]} />, host);
  await userEvent.click(page.getByRole('button', { name: 'Select an approval model' }));
  await userEvent.click(page.getByText('Reviewer', { exact: true }));
  await expect.element(page.getByRole('status')).toHaveTextContent('Approval model saved');
  expect(updateSettings).toHaveBeenCalledWith({ permissionReviewModel: 'provider/reviewer' });
  await expect.element(page.getByRole('button', { name: 'Reviewer' })).toBeInTheDocument();
});
