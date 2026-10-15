import { it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { defaultConfig } from "../src/core/contracts";
it("activates strict policy in a new immutable config without rewriting old case snapshots", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const files = (await readdir("migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files.filter((file) => !file.startsWith("0010")))
      await db.exec(await readFile(`migrations/${file}`, "utf8"));
    const { publicationPolicy: _policy, ...legacy } = defaultConfig;
    const snapshot = JSON.stringify(legacy);
    await db
      .prepare("INSERT INTO trading_config_versions VALUES ('legacy-v1',1,?,1)")
      .bind(snapshot)
      .run();
    await db.exec(
      "INSERT INTO system_state VALUES ('active_config','legacy-v1')",
    );
    const sql = await readFile(
      "migrations/0010_strict_publication_policy.sql",
      "utf8",
    );
    await db.exec(sql);
    const active = await db
      .prepare(
        "SELECT snapshot FROM trading_config_versions WHERE id=(SELECT value FROM system_state WHERE key='active_config')",
      )
      .first<{ snapshot: string }>();
    expect(JSON.parse(active!.snapshot).publicationPolicy).toEqual(
      defaultConfig.publicationPolicy,
    );
    expect(
      await db
        .prepare(
          "SELECT snapshot FROM trading_config_versions WHERE id='legacy-v1'",
        )
        .first(),
    ).toEqual({ snapshot });
    await db.exec(sql);
    expect(
      await db
        .prepare("SELECT COUNT(*) n FROM trading_config_versions")
        .first(),
    ).toEqual({ n: 2 });
  } finally {
    await mf.dispose();
  }
});
