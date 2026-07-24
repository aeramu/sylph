import { createResource, createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { ProjectInfo } from '../../../types';
import AddProjectModal from '../../projects/AddProjectModal';
import { deleteProject, listProjects } from '../../projects/api';

function directorySummary(project: ProjectInfo) {
  const count = project.directories.length;
  if (count === 0) return 'No workspace directories';
  return `${count} workspace director${count === 1 ? 'y' : 'ies'}`;
}

export default function ProjectsSettings(props: { onProjectsChanged?: (deletedProjectId?: string) => void }) {
  const [projects, { refetch: reloadProjects }] = createResource(listProjects);
  const [showAddProject, setShowAddProject] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<ProjectInfo | null>(null);

  const handleSaved = async () => {
    setShowAddProject(false);
    setEditingProject(null);
    await reloadProjects();
    props.onProjectsChanged?.();
  };

  const handleDelete = async (project: ProjectInfo) => {
    await deleteProject(project.id);
    setEditingProject(null);
    await reloadProjects();
    props.onProjectsChanged?.(project.id);
  };

  return (
    <div class="settings-projects">
      <div class="settings-projects-intro">
        <div>
          <p class="settings-description">Manage the projects available in the sidebar and project picker.</p>
          <Show when={!projects.loading && !projects.error}>
            <div class="settings-project-count">{(projects() || []).length} project{(projects() || []).length === 1 ? '' : 's'}</div>
          </Show>
        </div>
        <button class="settings-provider-button primary settings-project-add" type="button" onClick={() => setShowAddProject(true)}>
          <span aria-hidden="true">＋</span> Add project
        </button>
      </div>

      <Show when={!projects.loading} fallback={<div class="settings-modal-empty">Loading projects...</div>}>
        <Show when={!projects.error} fallback={<div class="settings-provider-message">{projects.error instanceof Error ? projects.error.message : 'Could not load projects.'}</div>}>
          <Show when={(projects() || []).length > 0} fallback={<div class="settings-projects-empty"><strong>No projects yet</strong><span>Add a project to group chats and share workspace directories.</span></div>}>
            <div class="settings-resource-list settings-project-list">
              <For each={projects()}>
                {(project) => (
                  <button class="settings-resource-card clickable settings-project-card" type="button" onClick={() => setEditingProject(project)} aria-label={`Edit ${project.name}`}>
                    <span class="settings-project-card-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none"><path d="M3.75 7.75A1.75 1.75 0 0 1 5.5 6h4.25l2 2h6.75a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 18.5 19H5.5a1.75 1.75 0 0 1-1.75-1.75z"/></svg>
                    </span>
                    <span class="settings-project-card-content">
                      <span class="settings-project-card-heading">
                        <span class="settings-project-card-name">{project.name}</span>
                        <span class="settings-project-edit-label">Edit <span aria-hidden="true">→</span></span>
                      </span>
                      <span class="settings-project-card-summary">{directorySummary(project)}</span>
                      <Show when={project.directories.length > 0}>
                        <span class="settings-project-paths">
                          <For each={project.directories}>{(directory) => <span title={directory.path}>{directory.name} · {directory.path}</span>}</For>
                        </span>
                      </Show>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      <Portal>
        <Show when={showAddProject()}>
          <AddProjectModal onClose={() => setShowAddProject(false)} onSaved={() => void handleSaved()} />
        </Show>
        <Show when={editingProject()} keyed>
          {(project) => (
            <AddProjectModal
              project={project}
              onClose={() => setEditingProject(null)}
              onSaved={() => void handleSaved()}
              onDelete={() => handleDelete(project)}
            />
          )}
        </Show>
      </Portal>
    </div>
  );
}
