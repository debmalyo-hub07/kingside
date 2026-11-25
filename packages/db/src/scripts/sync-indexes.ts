// SPDX-License-Identifier: AGPL-3.0-or-later
// Creates/updates indexes declared in models.ts. Run: pnpm db:indexes

import { connectDb, disconnectDb } from "../connect";
import { allModels } from "../models";

try {
  await connectDb();
  for (const m of allModels) {
    const dropped = await m.syncIndexes();
    console.log(
      `${m.collection.collectionName}: indexes synced${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`,
    );
  }
} finally {
  await disconnectDb();
}
