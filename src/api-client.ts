// ============================================================
// n8n-mcp-lite: n8n REST API client
// ============================================================

import type {
  N8nApiConfig,
  N8nWorkflowRaw,
  N8nWorkflowListItem,
  N8nExecution,
} from "./types.js";

export class N8nApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: N8nApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      params?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(`/api/v1${path}`, this.baseUrl);
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        url.searchParams.set(k, v);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url.toString(), {
        method: options.method ?? "GET",
        headers: {
          "X-N8N-API-KEY": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `n8n API error ${resp.status}: ${resp.statusText}. ${text}`
        );
      }

      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Workflows ---

  async listWorkflows(
    cursor?: string,
    limit = 100
  ): Promise<{ data: N8nWorkflowListItem[]; nextCursor?: string }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) params.cursor = cursor;

    const resp = await this.request<{ data: N8nWorkflowListItem[]; nextCursor?: string }>(
      "/workflows",
      { params }
    );
    return resp;
  }

  async getWorkflow(id: string): Promise<N8nWorkflowRaw> {
    return this.request<N8nWorkflowRaw>(`/workflows/${id}`);
  }

  async createWorkflow(
    workflow: Partial<N8nWorkflowRaw>
  ): Promise<N8nWorkflowRaw> {
    return this.request<N8nWorkflowRaw>("/workflows", {
      method: "POST",
      body: workflow,
    });
  }

  async updateWorkflow(
    id: string,
    workflow: Partial<N8nWorkflowRaw>
  ): Promise<N8nWorkflowRaw> {
    return this.request<N8nWorkflowRaw>(`/workflows/${id}`, {
      method: "PUT",
      body: workflow,
    });
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.request(`/workflows/${id}`, { method: "DELETE" });
  }

  async activateWorkflow(id: string): Promise<N8nWorkflowRaw> {
    return this.request<N8nWorkflowRaw>(`/workflows/${id}/activate`, {
      method: "POST",
    });
  }

  async deactivateWorkflow(id: string): Promise<N8nWorkflowRaw> {
    return this.request<N8nWorkflowRaw>(`/workflows/${id}/deactivate`, {
      method: "POST",
    });
  }

  // --- Executions ---

  async listExecutions(params?: {
    workflowId?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: N8nExecution[]; nextCursor?: string }> {
    const qp: Record<string, string> = {};
    if (params?.workflowId) qp.workflowId = params.workflowId;
    if (params?.status) qp.status = params.status;
    if (params?.limit) qp.limit = String(params.limit);
    if (params?.cursor) qp.cursor = params.cursor;

    return this.request("/executions", { params: qp });
  }

  async getExecution(id: string): Promise<N8nExecution> {
    return this.request<N8nExecution>(`/executions/${id}`);
  }

  async deleteExecution(id: string): Promise<void> {
    await this.request(`/executions/${id}`, { method: "DELETE" });
  }

  // --- Webhook trigger ---

  async triggerWebhook(
    path: string,
    method: string = "POST",
    data?: unknown
  ): Promise<unknown> {
    const url = new URL(`/webhook/${path}`, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url.toString(), {
        method,
        headers: { "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      return await resp.json().catch(() => ({ status: resp.status }));
    } finally {
      clearTimeout(timer);
    }
  }

  async triggerWebhookTest(
    path: string,
    method: string = "POST",
    data?: unknown
  ): Promise<unknown> {
    const url = new URL(`/webhook-test/${path}`, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url.toString(), {
        method,
        headers: { "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      return await resp.json().catch(() => ({ status: resp.status }));
    } finally {
      clearTimeout(timer);
    }
  }
}
