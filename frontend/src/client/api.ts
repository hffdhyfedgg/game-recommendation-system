const TOKEN_KEY = "playnext_token";

// Эти функции работают только в браузере
export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  auth?: boolean;
}

export async function api(path: string, options: ApiOptions = {}): Promise<unknown> {
  if (typeof window === 'undefined') {
    throw new Error('api() can only be called in the browser');
  }
  
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth && getToken()) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof data === "object" && data !== null 
      ? (data as Record<string, string>).detail || (data as Record<string, string>).message 
      : data;
    if (response.status === 401 && auth) {
      clearToken();
      if (!window.location.pathname.endsWith("/index.html") && window.location.pathname !== "/" && !window.location.pathname.endsWith("/")) {
        window.location.href = "/";
      }
    }
    throw new Error(message || "Request failed.");
  }

  return data;
}

export function requireAuth(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!getToken()) {
    window.location.href = "/";
    return false;
  }
  return true;
}

export function logout(): void {
  if (typeof window === 'undefined') {
    return;
  }
  clearToken();
  window.location.href = "/";
}
