import { getProjectDirectory, type Project } from "../projects.ts";

export function workspacePrompt(project: Project | undefined, directoryId: string | undefined, cwd: string) {
  if (!project || project.directories.length < 2) return undefined;
  const active = getProjectDirectory(project, directoryId);
  const roots = project.directories.map((directory) =>
    `- ${directory.name}${directory.id === active.id ? " (active cwd)" : ""}: ${directory.id === active.id ? cwd : directory.path}`,
  );
  return [
    "This is a multi-directory Sylph project. The shell and relative file tools start in the active directory, but all listed roots belong to the same project and may be accessed with absolute paths.",
    "Project directories:",
    ...roots,
    "When discussing or editing files outside the active cwd, use the listed absolute path. @mentions use root aliases such as @root-name/path/to/file.",
    "Each directory is a separate Git repository; run Git commands in the directory they target.",
  ].join("\n");
}
