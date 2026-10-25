"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
  code?: string;
  constructor(message: string, status: number, fieldErrors?: Record<string, string>, code?: string) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

// ───────────── Session token for embedded pages ─────────────
// Used only when the browser refuses cookies inside an embedded preview. It lives in this tab's sessionStorage,
// so it is discarded when the tab closes and is never shared with other tabs. Normal tabs use the httpOnly cookie.

const SESSION_STORAGE_KEY = "ce.session";

export function getStoredSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable (for example in some sandboxed frames). */
export function storeSessionToken(token: string): boolean {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) === token;
  } catch {
    return false;
  }
}

export function clearStoredSessionToken(): void {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Requests that must not bounce a signed-out visitor to /login (the caller handles the failure itself). */
const NO_LOGIN_REDIRECT = ["/api/auth/", "/api/me/context"];

export async function apiFetch<T = unknown>(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = typeof window !== "undefined" ? getStoredSessionToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error — check your internet connection and try again.", 0);
  }
  if (res.status === 401 && !NO_LOGIN_REDIRECT.some((p) => url.startsWith(p))) {
    if (token) clearStoredSessionToken();
    if (typeof window !== "undefined") window.location.href = "/login?expired=1";
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? "Request failed. Please try again.", res.status, data?.fieldErrors, data?.code);
  return data as T;
}

/** GET helper with loading/error state. Keeps previous data while refetching (stale-while-revalidate). */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: string }>({ url: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    apiFetch<T>(url)
      .then((data) => {
        if (!cancelled) setState({ url, data });
      })
      .catch((e: Error) => {
        if (!cancelled) setState((s) => ({ url, data: s.data, error: e.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.url === url;
  return {
    data: state.data,
    error: current ? state.error : undefined,
    loading: url !== null && !current,
    reload,
  };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Random id that also works on non-HTTPS origins where crypto.randomUUID is unavailable. */
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downscales an uploaded image to keep stored logos/product images small. */
export async function fileToResizedDataUrl(file: File, max = 256, type: "image/png" | "image/jpeg" = "image/png", quality = 0.82): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Please choose a PNG, JPEG or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is too large (max 8 MB).");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("We couldn't read that image. Try another file.");
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process the image.");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  const url = canvas.toDataURL(type, quality);
  if (url.length > 240_000) throw new Error("That image is still too large after resizing. Use a simpler image.");
  return url;
}
