import { pathToFileURL } from "node:url";

/** A health snapshot is intentionally separate from end-to-end acceptance. */
export function assessHealth(health) {
  const expected = {
    api: "OK",
    chart_db: "OK",
    ai_providers: "OK",
    discord: "CONFIGURED",
  };
  const checks = Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [
      key,
      health?.[key] === value
        ? "PASS"
        : ["OK", "DOWN", "DEGRADED", "CONFIGURED", "NOT_CONFIGURED"].includes(
              health?.[key],
            )
          ? health[key]
          : "UNKNOWN",
    ]),
  );
  return {
    runtime_health: Object.values(checks).every((value) => value === "PASS")
      ? "PASS"
      : "FAIL",
    checks,
    full_case_pipeline: "NOT_ASSESSED",
    configured_failover: "NOT_ASSESSED",
    real_discord_delivery: "NOT_ASSESSED",
    physical_device_qa: "NOT_ASSESSED",
  };
}

async function healthBody(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("HEALTH_HTTP_ERROR");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("HEALTH_BODY_MISSING");
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new Error("HEALTH_BODY_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function checkProduction(
  origin,
  fetcher = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error(
      "BYGA_PUBLIC_ORIGIN must be an exact HTTPS origin without credentials or path.",
    );
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(origin + "/api/v1/health", {
        signal: AbortSignal.timeout(10000),
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      result = assessHealth(await healthBody(response));
    } catch {
      // Never print server response bodies, authentication material or transport details.
      result = { ...assessHealth(null), error: "HEALTH_UNAVAILABLE" };
    }
    if (result.runtime_health === "PASS") break;
    if (attempt < 2) await sleep(2000 * (attempt + 1));
  }
  return { checked_at: new Date().toISOString(), origin, ...result };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await checkProduction(process.env.BYGA_PUBLIC_ORIGIN ?? "");
    console.log(JSON.stringify(result, null, 2));
    if (result.runtime_health !== "PASS") process.exitCode = 1;
  } catch {
    console.error("Set BYGA_PUBLIC_ORIGIN to an exact HTTPS origin.");
    process.exitCode = 1;
  }
}
