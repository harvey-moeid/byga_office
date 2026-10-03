import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/ui/data";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("API client resilience", () => {
  it("preserves POST bodies and credentials without exposing network errors", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(await api("/admin/config", false)).toEqual({ ok: true });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: "false",
    });
  });
  it("aborts stalled requests after 15 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const request = api("/office/state");
    const assertion = expect(request).rejects.toThrow("Server belum merespons");
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("distinguishes offline errors from non-JSON server failures", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(api("/office/state")).rejects.toThrow("Koneksi terputus");
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("gateway unavailable", { status: 502 }),
        ),
    );
    await expect(api("/office/state")).rejects.toThrow(
      "Tidak dapat memuat data dari server",
    );
  });
  it("caller cancellation stops requests and removes the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const controller = new AbortController();
    const request = api("/office/state", undefined, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
