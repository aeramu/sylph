export interface ProjectDirectory {
  id: string;
  name: string;
  path: string;
}

export interface Project {
  id: string;
  name: string;
  /** First directory path; empty for projects that do not have a root yet. */
  path: string;
  directories: ProjectDirectory[];
  /** Runtime-only directory represented by `path`; absent from stored configuration. */
  activeDirectoryId?: string;
}

export interface ProjectDirectoryInput {
  id?: unknown;
  name?: unknown;
  path: string;
}
