import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { GitPullRequest, PullRequestContext } from '../../lib/gitPatch';
import CustomSelect from '../../shared/ui/CustomSelect';
import { createPullRequest, getPullRequestContext, type GitScope } from './api';
import './CreatePullRequestModal.css';

export default function CreatePullRequestModal(props: {
  scope: GitScope;
  onClose: () => void;
  onCreated: (pullRequest: GitPullRequest) => void;
}) {
  const [context, setContext] = createSignal<PullRequestContext>();
  const [loading, setLoading] = createSignal(true);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [body, setBody] = createSignal('');
  const [base, setBase] = createSignal('');
  const [draft, setDraft] = createSignal(false);
  const [publishBranch, setPublishBranch] = createSignal(true);
  let active = true;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getPullRequestContext(props.scope);
      if (!next || typeof next !== 'object' || typeof next.branch !== 'string' || !Array.isArray(next.baseBranches)) {
        throw new Error('The server returned an invalid pull request context. Restart Sylph and try again.');
      }
      if (!active) return;
      setContext(next);
      setTitle(next.suggestedTitle || '');
      setBase(next.defaultBaseBranch || next.baseBranches[0] || 'main');
      // Push by default even when the branch already exists remotely so the PR
      // includes any newer local commits. This is a normal non-force push.
      setPublishBranch(true);
    } catch (caught) {
      if (active) setError(caught instanceof Error ? caught.message : 'Failed to load pull request details');
    } finally {
      if (active) setLoading(false);
    }
  };

  const submit = async () => {
    if (!title().trim() || !base() || creating()) return;
    setCreating(true);
    setError('');
    try {
      const pullRequest = await createPullRequest(props.scope, {
        title: title().trim(), body: body().trim(), base: base(), draft: draft(), publishBranch: publishBranch(),
      });
      if (!active) return;
      props.onCreated(pullRequest);
      props.onClose();
    } catch (caught) {
      if (active) setError(caught instanceof Error ? caught.message : 'Failed to create pull request');
    } finally {
      if (active) setCreating(false);
    }
  };

  const openPullRequest = (pullRequest: GitPullRequest) => {
    window.open(pullRequest.url, '_blank', 'noopener,noreferrer');
  };

  const cannotCreate = () => {
    const value = context();
    return !value || value.provider !== 'github' || value.detached || !value.authentication.configured
      || !!value.existingPullRequest || value.branch === base() || !title().trim() || !base();
  };

  onMount(() => void load());
  onCleanup(() => { active = false; });

  return (
    <div class="skills-modal-overlay pull-request-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !creating()) props.onClose();
    }}>
      <div class="skills-modal pull-request-modal" role="dialog" aria-modal="true" aria-labelledby="pull-request-title">
        <div class="pull-request-header">
          <div>
            <div class="pull-request-kicker">GitHub</div>
            <h2 id="pull-request-title">Create Pull Request</h2>
            <p>Publish the current branch and open it for review.</p>
          </div>
          <button class="pull-request-close" onClick={props.onClose} disabled={creating()} aria-label="Close">✕</button>
        </div>

        <div class="pull-request-body">
          <Show when={loading()}><div class="pull-request-loading"><span class="pull-request-spinner"/>Loading repository details…</div></Show>
          <Show when={!loading() && context()} keyed>{(details) => <>
            <Show when={details.provider !== 'github'}>
              <div class="pull-request-notice error">Pull request creation currently supports GitHub.com remotes only.</div>
            </Show>
            <Show when={details.detached}>
              <div class="pull-request-notice error">Check out a branch before creating a pull request.</div>
            </Show>
            <Show when={details.provider === 'github' && !details.authentication.configured}>
              <div class="pull-request-notice error">GitHub authentication is not configured. Set <code>GH_TOKEN</code> or <code>GITHUB_TOKEN</code> in the Sylph server environment, or sign in with the <code>gh</code> CLI.</div>
            </Show>
            <Show when={details.existingPullRequest} keyed>{(existing) =>
              <div class="pull-request-existing">
                <div><strong>Pull request #{existing.number} is already open</strong><span>{existing.title}</span></div>
                <button onClick={() => openPullRequest(existing)}>Open Pull Request ↗</button>
              </div>
            }</Show>
            <Show when={base() && details.branch === base()}>
              <div class="pull-request-notice error">Choose a base branch other than {details.branch}.</div>
            </Show>

            <div class="pull-request-summary">
              <div><span>Repository</span><strong>{details.repository ? `${details.repository.owner}/${details.repository.name}` : 'Unsupported remote'}</strong></div>
              <div><span>Source</span><strong>{details.branch}</strong></div>
              <div><span>Commits</span><strong>{details.commitCount} ahead</strong></div>
            </div>

            <label class="pull-request-field">
              <span>Base branch</span>
              <CustomSelect
                value={base()}
                onChange={setBase}
                options={details.baseBranches.map((branch) => ({ value: branch, label: branch }))}
                placeholder="Choose a base branch"
                searchable
                searchPlaceholder="Search branches…"
                position="bottom"
              />
            </label>
            <label class="pull-request-field">
              <span>Title</span>
              <input value={title()} maxlength={256} onInput={(event) => setTitle(event.currentTarget.value)} placeholder="Describe the change" />
            </label>
            <label class="pull-request-field">
              <span>Description <small>optional</small></span>
              <textarea value={body()} onInput={(event) => setBody(event.currentTarget.value)} rows={7} placeholder="What changed, and what should reviewers know?" />
            </label>

            <div class="pull-request-options">
              <label><input type="checkbox" checked={publishBranch()} onChange={(event) => setPublishBranch(event.currentTarget.checked)} /><span>Push branch before creating</span></label>
              <label><input type="checkbox" checked={draft()} onChange={(event) => setDraft(event.currentTarget.checked)} /><span>Create as draft</span></label>
            </div>
            <Show when={details.dirtyFileCount > 0}>
              <div class="pull-request-warning">{details.dirtyFileCount} uncommitted file{details.dirtyFileCount === 1 ? '' : 's'} will not be included.</div>
            </Show>
          </>}</Show>
          <Show when={error()}><div class="pull-request-notice error">{error()}</div></Show>
        </div>

        <div class="pull-request-footer">
          <button class="pull-request-cancel" onClick={props.onClose} disabled={creating()}>Cancel</button>
          <button class="pull-request-submit" onClick={() => void submit()} disabled={loading() || creating() || cannotCreate()}>
            {creating() ? 'Creating…' : draft() ? 'Create Draft Pull Request' : 'Create Pull Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
