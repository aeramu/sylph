import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import AutocompletePopup from './AutocompletePopup';
import SettingsNavigation, { type SettingsSection } from '../../settings/components/SettingsNavigation';
import ExtensionUiHost from '../../chat/components/ExtensionUiHost';

let dispose: (() => void) | undefined;
function mount(component: () => any) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(component, host);
}
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; });

describe('AutocompletePopup', () => {
  it('applies the clicked command', async () => {
    const applied: string[] = [];
    mount(() => (
      <AutocompletePopup
        mentions={null}
        commands={[{ name: 'model', source: 'built-in' }, { name: 'thinking', source: 'built-in' }]}
        selectedIndex={0}
        mentionHeader=""
        mentionEmpty=""
        listRef={() => {}}
        onMention={() => {}}
        onCommand={(command) => applied.push(command.name)}
      />
    ));
    await userEvent.click(page.getByText('/thinking'));
    expect(applied).toEqual(['thinking']);
  });

  it('shows the empty state when there are no mentions', async () => {
    mount(() => (
      <AutocompletePopup mentions={[]} commands={null} selectedIndex={0} mentionHeader="Mentions" mentionEmpty="No matching files" listRef={() => {}} onMention={() => {}} onCommand={() => {}} />
    ));
    await expect.element(page.getByText('No matching files')).toBeInTheDocument();
  });
});

describe('SettingsNavigation', () => {
  it('switches the active section on click', async () => {
    const [active, setActive] = createSignal<SettingsSection>('provider');
    mount(() => <SettingsNavigation active={active()} onSelect={setActive} onClose={() => {}} />);
    await userEvent.click(page.getByText('Git'));
    expect(active()).toBe('git');
  });
});

describe('ExtensionUiHost', () => {
  it('keeps composer children mounted but hidden while a request is active', async () => {
    mount(() => (
      <ExtensionUiHost widgets={{}} statuses={{}} uiRequest={null} questionsRequest={null} onRespond={() => {}}>
        <textarea data-testid="composer" />
      </ExtensionUiHost>
    ));
    const wrapper = document.querySelector('[data-testid="composer"]')!.parentElement as HTMLElement;
    expect(wrapper.style.display).toBe('');

    dispose?.();
    mount(() => (
      <ExtensionUiHost widgets={{}} statuses={{}} uiRequest={{ id: '1', method: 'confirm', message: 'Allow?' } as any} questionsRequest={null} onRespond={() => {}}>
        <textarea data-testid="composer" />
      </ExtensionUiHost>
    ));
    const hidden = document.querySelector('[data-testid="composer"]')!.parentElement as HTMLElement;
    expect(hidden.style.display).toBe('none');
  });
});
