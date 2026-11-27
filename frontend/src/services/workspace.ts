import type { ContainerTemplate, EquipmentCategory, WarehouseLayout } from "../layout/types";

export interface Warehouse {
  id: string;
  name: string;
  created_at: string;
}

export interface LayoutRevision {
  id: string;
  warehouse_id: string;
  state: "draft" | "published";
  version: number;
  document: WarehouseLayout;
  created_at: string;
}

export interface LayoutIssue {
  path: string; code: string; message: string; severity: 'error' | 'warning';
  object_id?: string; count?: number; names?: string[]; level?: number;
}

export class WorkspaceError extends Error {
  constructor(public status: number, message: string, public issues: LayoutIssue[] = []) {
    super(message);
  }
}

export type ContainerInput = Omit<ContainerTemplate, 'id' | 'created_at' | 'updated_at'>;

export interface LayoutValidation {
  version: number;
  valid: boolean;
  issues: LayoutIssue[];
}

/** Tokens remain in memory; callers clear their client on sign-out. */
export function workspaceClient(token: string) {
  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`/api/workspace${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail;
      if (detail && typeof detail === "object" && Array.isArray(detail.issues))
        throw new WorkspaceError(response.status, String(detail.message ?? "Layout validation failed"), detail.issues);
      throw new WorkspaceError(response.status,
        typeof detail === "string" ? detail : Array.isArray(detail) ? String(detail[0]?.msg ?? "Invalid request") : "Workspace request failed");
    }
    return data as T;
  }

  const revisionPath = (warehouse: string, revision: string) =>
    `/warehouses/${encodeURIComponent(warehouse)}/revisions/${encodeURIComponent(revision)}`;

  return {
    me: () => request<{ organization_id: string; user_id: string }>("/me"),
    warehouses: () => request<Warehouse[]>("/warehouses"),
    create: (name: string, document: WarehouseLayout) =>
      request<LayoutRevision>("/warehouses", "POST", { name, document }),
    createEmpty: (name: string, width: number, depth: number, height: number) =>
      request<LayoutRevision>("/warehouses/empty", "POST", { name, width, depth, height }),
    revisions: (warehouse: string) => request<Omit<LayoutRevision, "document" | "warehouse_id">[]>(
      `/warehouses/${encodeURIComponent(warehouse)}/revisions`),
    revision: (warehouse: string, revision: string) =>
      request<LayoutRevision>(revisionPath(warehouse, revision)),
    validate: (revision: LayoutRevision) =>
      request<LayoutValidation>(`${revisionPath(revision.warehouse_id, revision.id)}/validation`),
    save: (revision: LayoutRevision, document: WarehouseLayout) =>
      request<LayoutRevision>(revisionPath(revision.warehouse_id, revision.id), "PUT", {
        expected_version: revision.version, document,
      }),
    publish: (revision: LayoutRevision) =>
      request<LayoutRevision>(`${revisionPath(revision.warehouse_id, revision.id)}/publish`, "POST", {
        expected_version: revision.version,
      }),
    containers: () => request<ContainerTemplate[]>("/containers"),
    createContainer: (input: ContainerInput) => request<ContainerTemplate>("/containers", "POST", input),
    updateContainer: (id: string, input: ContainerInput) =>
      request<ContainerTemplate>(`/containers/${encodeURIComponent(id)}`, "PUT", input),
    deleteContainer: (id: string) => request<null>(`/containers/${encodeURIComponent(id)}`, "DELETE"),
    equipmentCatalog: () => request<{ version: number; categories: EquipmentCategory[] }>("/equipment-catalog"),
    fork: (revision: LayoutRevision) =>
      request<LayoutRevision>(`${revisionPath(revision.warehouse_id, revision.id)}/fork`, "POST"),
  };
}
