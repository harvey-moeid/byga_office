import assert from "node:assert/strict";

// Probe the deployed credentials and saved models, rather than an unrelated
// provider. Cache each provider/model result for this smoke run only.
export async function verifyProviderPaths(characters, configured, probe) {
  assert.ok(characters.length > 0, "Active character configuration is empty");
  const results = new Map();
  const paths = [];
  for (const character of characters) {
    let path;
    for (const role of ["primary", "fallback"]) {
      const provider = character[`${role}_provider`];
      const model = character[`${role}_model`];
      if (configured.get(provider) !== true) continue;
      assert.ok(
        typeof model === "string" && model.trim().length > 0,
        `Active character ${character.id} has an invalid ${role} model`,
      );
      const key = JSON.stringify([provider, model]);
      if (!results.has(key))
        results.set(key, {
          provider,
          model,
          ...(await probe(provider, model)),
        });
      if (results.get(key).status === "PASS") {
        path = { character: character.id, role, provider, model };
        break;
      }
    }
    assert.ok(
      path,
      `Active character ${character.id} has no working provider path; cron must remain disabled`,
    );
    paths.push(path);
  }
  const probes = [...results.values()];
  return {
    status: "PASS",
    degraded: paths.some((path) => path.role === "fallback"),
    probes,
    paths,
  };
}

export async function probeDeployedProvider(origin, cookie, provider, model) {
  let response;
  try {
    response = await fetch(origin + "/api/v1/admin/test-provider", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: provider, model }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { status: "UNAVAILABLE", reason: "TRANSPORT_ERROR" };
  }
  // Authentication, CSRF, routing and application errors are deployment
  // failures, even if another provider could answer a probe.
  assert.ok(
    [200, 503].includes(response.status),
    `Deployed provider probe failed: HTTP ${response.status}`,
  );
  const body = await response.json().catch(() => null);
  if (response.status === 503) {
    // Do not print upstream response text: provider errors may contain secrets.
    const quota =
      provider === "workers-ai" &&
      typeof body?.error === "string" &&
      /^4006:/.test(body.error);
    return {
      status: "UNAVAILABLE",
      reason: quota ? "DAILY_QUOTA_EXHAUSTED" : "PROVIDER_PROBE_FAILED",
    };
  }
  assert.ok(
    body?.ok === true && body.inference === "PASS" && body.model === model,
    "Deployed provider probe must verify structured inference for the selected model",
  );
  return { status: "PASS" };
}
