import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const name = "PROVIDER_KEYS_ENCRYPTION_KEY";
const { values } = parseArgs({ options: { config: { type: "string" } } });
if (!values.config) {
  const path = ".dev.vars";
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const pattern = /^PROVIDER_KEYS_ENCRYPTION_KEY\s*=\s*([^\r\n]*)$/m;
  const previous = content
    .match(pattern)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, "");
  if (previous) {
    if (!/^[a-f0-9]{64}$/i.test(previous))
      throw new Error(
        "Existing local encryption key is invalid; do not rotate it without migrating saved credentials.",
      );
    console.log("Local credential encryption key already exists; preserved.");
  } else {
    const line = name + "=" + randomBytes(32).toString("hex");
    writeFileSync(
      path,
      pattern.test(content)
        ? content.replace(pattern, line)
        : content +
            (content.endsWith("\n") || !content ? "" : "\n") +
            line +
            "\n",
      { mode: 0o600 },
    );
    console.log(
      "Local credential encryption key initialized in ignored .dev.vars; value hidden.",
    );
  }
  chmodSync(path, 0o600);
} else {
  const config = JSON.parse(readFileSync(values.config, "utf8"));
  if (
    !config.account_id ||
    !["staging", "production"].includes(config.vars?.APP_ENV) ||
    !config.vars?.PUBLIC_ORIGIN?.startsWith("https://")
  )
    throw new Error("A verified staging/production configuration is required.");
  const list = spawnSync(
    process.execPath,
    ["scripts/wrangler.mjs", "secret", "list", "--config", values.config],
    { encoding: "utf8", env: process.env },
  );
  if (list.status !== 0)
    throw new Error(
      "Cannot inspect Worker secret names; encryption key was not changed.",
    );
  const names = JSON.parse(list.stdout);
  if (
    !Array.isArray(names) ||
    names.some((entry) => !entry || typeof entry.name !== "string")
  )
    throw new Error(
      "Invalid secret inventory; encryption key was not changed.",
    );
  if (names.some((entry) => entry.name === name))
    console.log("Worker credential encryption key already exists; preserved.");
  else {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/wrangler.mjs",
        "secret",
        "put",
        name,
        "--config",
        values.config,
      ],
      {
        input: randomBytes(32).toString("hex") + "\n",
        encoding: "utf8",
        env: process.env,
      },
    );
    if (result.status !== 0)
      throw new Error(
        "Cannot initialize Worker encryption key. Provider runtime secrets remain unchanged.",
      );
    console.log(
      "Worker credential encryption key initialized; value hidden. Preserve this secret across deployments.",
    );
  }
}
