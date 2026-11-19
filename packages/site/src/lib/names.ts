import type { Space } from "./data";

/**
 * The name a workspace is shown by. An organisation's shared workspace was
 * created as "Everyone" (now "Shared"); while it keeps that default it is
 * shown in the reader's language. A name an admin gave it is shown as given.
 */
export function workspaceName(space: Pick<Space, "kind" | "name">, t: (k: string) => string): string {
  return space.kind === "shared" && (space.name === "Everyone" || space.name === "Shared") ? t("space.shared") : space.name;
}

/** Workspaces grouped by their organisation, in the order they came. */
export function byOrganisation<S extends Pick<Space, "tenantId" | "tenantName">>(spaces: S[]): Array<{ id: string; name: string; spaces: S[] }> {
  const groups = new Map<string, { id: string; name: string; spaces: S[] }>();
  for (const s of spaces) {
    const g = groups.get(s.tenantId) ?? { id: s.tenantId, name: s.tenantName ?? s.tenantId, spaces: [] };
    g.spaces.push(s);
    groups.set(s.tenantId, g);
  }
  return [...groups.values()];
}
