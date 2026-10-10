// This entry point is bundled only by Miniflare tests, never by Wrangler.
import worker, { Office as ProductionOffice } from "../src/server/index";
import { retryDeliveries } from "../src/server/discord";

export class Office extends ProductionOffice {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/__test/deliveries") {
      await retryDeliveries(this.env);
      return Response.json({ ok: true });
    }
    if (path === "/__test/alarm") {
      await this.alarm();
      return Response.json({ ok: true });
    }
    if (path === "/__test/storage") {
      return Response.json({
        alarm: await this.ctx.storage.getAlarm(),
        pendingTick: await this.ctx.storage.get("pending_tick"),
        buyCooldown: await this.ctx.storage.get("cooldown:BUY"),
        sellCooldown: await this.ctx.storage.get("cooldown:SELL"),
      });
    }
    if (path === "/__test/pause") {
      await this.ctx.storage.deleteAlarm();
      return Response.json({ ok: true });
    }
    if (path === "/__test/tick-due") {
      await this.ctx.storage.put("pending_tick", Date.now() - 1);
      return Response.json({ ok: true });
    }
    if (path === "/__test/clear-cooldown") {
      await this.ctx.storage.delete(["cooldown:BUY", "cooldown:SELL"]);
      return Response.json({ ok: true });
    }
    if (path === "/__test/mode" && request.method === "POST") {
      const body = (await request.json()) as { mode?: string };
      if (body.mode !== "LIVE" && body.mode !== "SIMULATION")
        return Response.json({ error: "invalid mode" }, { status: 400 });
      await this.ctx.storage.put("mode", body.mode);
      return Response.json({ ok: true });
    }
    if (path === "/__test/idle") {
      await this.ctx.storage.delete("return_until");
      return Response.json({ ok: true });
    }
    return super.fetch(request);
  }
}
export default worker;
