import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ScheduleEditor } from './SchedulesScreen';
import { updateSchedule } from './api';

vi.mock('./api', () => ({
  deleteSchedule: vi.fn(), listAllSchedules: vi.fn(), runSchedule: vi.fn(),
  listScheduleModels: async () => [{ value: 'test/large', label: 'test / large' }],
  updateSchedule: vi.fn(async () => ({})),
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; vi.clearAllMocks(); });

it('loads the saved model and allows saving the server default', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const schedule = { id: 'schedule', name: 'Daily', prompt: 'Summarize', kind: 'cron' as const, cron: '0 9 * * *', timezone: 'UTC', enabled: true, modelId: 'test/large', createdAt: '', updatedAt: '' };
  dispose = render(() => <ScheduleEditor schedule={schedule} onClose={() => {}} onSaved={async () => {}}/>, host);
  const select = page.getByRole('combobox', { name: 'Model', exact: true });
  await expect.element(select).toHaveValue('test/large');
  await select.selectOptions('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect(updateSchedule).toHaveBeenLastCalledWith(schedule, expect.objectContaining({ modelId: null }));
  await select.selectOptions('test/large');
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect(updateSchedule).toHaveBeenLastCalledWith(schedule, expect.objectContaining({ modelId: 'test/large' }));
});
