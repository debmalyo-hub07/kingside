// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-picks the daily puzzle for the next 30 days (the API also picks lazily, so this is optional).
// Run: pnpm --filter @kingside/backend db:daily

import { connectDb, disconnectDb } from "../connect";
import { dailyPuzzle, utcDate } from "../puzzles";

try {
  await connectDb();
  for (let i = 0; i < 30; i++) {
    const date = utcDate(new Date(Date.now() + i * 86_400_000));
    const p = await dailyPuzzle(date);
    console.log(date, p ? `${p.id} (${p.rating})` : "no puzzle available");
  }
} finally {
  await disconnectDb();
}
