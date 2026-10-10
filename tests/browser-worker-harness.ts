// Browser integration uses the real router, auth, Office.fetch and D1 writes.
// Automatic AI alarms are deliberately suppressed; pipeline execution has its
// own integration suite. This entry point is never deployed by Wrangler.
import worker, { Office as ProductionOffice } from "../src/server/index";
export class Office extends ProductionOffice {
  async alarm() {
    /* No external inference or Discord in browser tests. */
  }
}
export default worker;
