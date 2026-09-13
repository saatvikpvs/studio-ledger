/** The only place that talks to the server. */

const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  raw = false,
): Promise<T> {
  const response = await fetch(BASE + path, {
    credentials: "include", // session cookie
    headers:
      init.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });

  if (!response.ok) {
    let detail = response.statusText;
    let payload: unknown = null;
    try {
      payload = await response.json();
      const d = (payload as { detail?: unknown }).detail;
      if (typeof d === "string") detail = d;
      else if (Array.isArray(d) && d.length) {
        // Pydantic validation errors -- surface the first useful message.
        detail = (d[0] as { msg?: string }).msg ?? detail;
      } else if (d && typeof d === "object") {
        detail = (d as { message?: string }).message ?? detail;
      }
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(response.status, detail, payload);
  }

  if (raw) return (await response.blob()) as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const qs = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const api = {
  get: <T>(path: string, params: Record<string, unknown> = {}) =>
    request<T>(path + qs(params)),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),

  /** Triggers a browser download without leaving the page. */
  async download(path: string, params: Record<string, unknown>, filename: string) {
    const blob = await request<Blob>(path + qs(params), {}, true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
