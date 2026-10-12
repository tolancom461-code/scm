import { setupPhaseOne, cleanupPhaseOne } from "./phase-one-fixture";
import {
  createCertificate,
  decideCertificate,
} from "../server/modules/phase-one/service";
import { simpleCertificateInput } from "../shared/phase-one";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { closeDb } from "../server/db";
const f = await setupPhaseOne(365);
try {
  const c = await createCertificate(
    simpleCertificateInput.parse({
      contractId: f.contractId,
      certificateDate: f.date,
      mode: "percent",
      progress: "90",
      delayDays: 2,
      otherDeduction: "414",
      deductionReason: "UI test only",
    }),
    f.actors[0],
    randomUUID()
  );
  await decideCertificate(
    c.id,
    f.actors[1],
    "approve",
    "Isolated UI verification"
  );
  console.log(
    JSON.stringify({
      code: f.code,
      contractId: f.contractId,
      certificateId: c.id,
    })
  );
  for (let n = 0; n < 240; n++) {
    try {
      await access(".data/payment-card-ui-finished");
      break;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
} finally {
  await cleanupPhaseOne(f);
  await closeDb();
  console.log("Isolated UI fixture removed");
}
