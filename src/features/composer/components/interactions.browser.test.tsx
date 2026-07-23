import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import AutocompletePopup from './AutocompletePopup';
import Composer from '../Composer';
import SettingsNavigation, { type SettingsSection } from '../../settings/components/SettingsNavigation';
import ExtensionUiHost from '../../chat/components/ExtensionUiHost';
import DirectoryPicker from '../../../shared/ui/DirectoryPicker';

let dispose: (() => void) | undefined;
function mount(component: () => any) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(component, host);
}
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; });

describe('DirectoryPicker', () => {
  it('offers to create a folder when the searched path does not exist', async () => {
    const created: Array<{ parentPath: string; name: string }> = [];
    let selectedPath = '';
    mount(() => (
      <DirectoryPicker path="/workspace" alias="" onPathChange={(value) => { selectedPath = value; }} onAliasChange={() => {}}
        loadDirectories={async (value) => value === '/workspace/notes'
          ? { currentPath: '/workspace', directories: [], createCandidate: { name: 'notes', path: '/workspace/notes', parentPath: '/workspace' } }
          : { currentPath: '/workspace', directories: [] }}
        createDirectory={async (parentPath, name) => {
          created.push({ parentPath, name });
          return { name, path: `${parentPath}/${name}` };
        }} suggestionsId="test-directory-suggestions" showAlias={false}/>
    ));

    const input = page.getByPlaceholder('/Users/you/code/project');
    await userEvent.fill(input, '/workspace/notes');
    const createOption = page.getByRole('option', { name: /Create “notes”/ });
    await expect.element(createOption).toBeInTheDocument();
    await expect.element(createOption).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(createOption);

    expect(created).toEqual([{ parentPath: '/workspace', name: 'notes' }]);
    expect(selectedPath).toBe('/workspace/notes');
    await expect.element(input).toHaveValue('/workspace/notes');
  });
});

describe('AutocompletePopup', () => {
  it('applies the clicked command', async () => {
    const applied: string[] = [];
    mount(() => (
      <div style={{ position: 'fixed', left: '1rem', bottom: '1rem', width: '30rem' }}>
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
      </div>
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

describe('Composer', () => {
  it('submits review-comment chips with the next message', async () => {
    let submitted: any[] | undefined;
    mount(() => (
      <Composer
        isConnected
        isProcessing={false}
        disabled={false}
        commands={[]}
        draftKey="review-test"
        draftText="Please fix this"
        onDraftChange={() => {}}
        models={[]}
        selectedModel=""
        onSelectModel={() => {}}
        thinkingLevels={[]}
        selectedThinkingLevel="off"
        onSelectThinkingLevel={() => {}}
        reviewComments={[{
          id: 'comment-1', surface: 'git', path: 'src/api.ts', quote: 'return oldValue', comment: 'Keep the fallback.',
          lineStart: 42, lineEnd: 42, side: 'new', changeSet: 'unstaged',
        }]}
        onRemoveReviewComment={() => {}}
        onSubmit={(_text, _attachments, comments) => { submitted = comments; }}
        onStop={() => {}}
      />
    ));

    await userEvent.click(page.getByRole('button', { name: 'Send message' }));
    expect(submitted).toEqual([expect.objectContaining({ id: 'comment-1', path: 'src/api.ts', comment: 'Keep the fallback.' })]);
  });

  it('keeps the textarea as the only visible text renderer when highlighting mentions', async () => {
    mount(() => (
      <Composer
        isConnected
        isProcessing={false}
        disabled={false}
        commands={[]}
        draftKey="test"
        draftText=""
        onDraftChange={() => {}}
        models={[]}
        selectedModel=""
        onSelectModel={() => {}}
        thinkingLevels={[]}
        selectedThinkingLevel="off"
        onSelectThinkingLevel={() => {}}
        reviewComments={[]}
        onRemoveReviewComment={() => {}}
        onSubmit={() => {}}
        onStop={() => {}}
      />
    ));

    const textarea = document.querySelector('.input-field') as HTMLTextAreaElement;
    await userEvent.fill(textarea, '@src/file.ts followed by enough ordinary text to exercise the mirror layer');
    const mirror = document.querySelector('.input-highlight-layer') as HTMLDivElement;

    expect(textarea.classList.contains('has-highlight-layer')).toBe(false);
    expect(getComputedStyle(textarea).color).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(mirror).color).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(mirror).webkitTextFillColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(mirror.querySelector('.input-mention-highlight')!).color).toBe('rgba(0, 0, 0, 0)');
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
