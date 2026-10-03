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
      return Response.json({ alarm: await this.ctx.storage.getAlarm() });
    }
    if (path === "/__test/idle") {
      await this.ctx.storage.delete("return_until");
      return Response.json({ ok: true });
    }
    return super.fetch(request);
  }
}
export default worker;
