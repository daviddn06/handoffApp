import { useCallback, useEffect, useState } from "react";
export class ApiError extends Error {
  status: number;
  /** A stable identifier the UI can branch on, such as "account_exists". */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("handoff:session-expired"));
    throw new ApiError(
      payload?.error || "Something went wrong. Please try again.",
      response.status,
      payload?.code,
    );
  }
  return payload as T;
}
export const json = (data: unknown) => JSON.stringify(data);
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!path),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, setData, error, loading, refresh };
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export function dateLabel(value: string, year = false) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) },
  );
}
export const today = () => new Date().toLocaleDateString("en-CA");
export function safeNext(value: string | null) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/sign-")
    ? value
    : "/browse";
}
/** Monthly savings against the original lease, or null when not shared or not lower. */
export function savings(listing: { price: number; originalPrice?: number | null }) {
  const original = listing.originalPrice;
  if (!original || original <= listing.price) return null;
  const amount = original - listing.price;
  return { amount, percent: Math.round((amount / original) * 100), original };
}
