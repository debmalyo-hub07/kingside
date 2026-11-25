// SPDX-License-Identifier: AGPL-3.0-or-later
// Collections from CLAUDE.md §7. Only server code may import this.

import mongoose, { type InferSchemaType, type Model, type Schema as SchemaType } from "mongoose";

// Mongoose is CommonJS; Node ESM (tsx scripts) only exposes its default export.
const { model, models, Schema } = mongoose;

function defineModel<S extends SchemaType>(name: string, schema: S): Model<InferSchemaType<S>> {
  // Reuse the compiled model across Next.js hot reloads.
  return (models[name] ?? model(name, schema)) as unknown as Model<InferSchemaType<S>>;
}

const puzzleSchema = new Schema(
  {
    _id: { type: String, required: true },
    fen: { type: String, required: true },
    moves: { type: [String], required: true },
    rating: { type: Number, required: true },
    ratingDev: { type: Number, required: true },
    popularity: { type: Number, required: true },
    nbPlays: { type: Number, required: true },
    themes: { type: [String], default: [] },
    openingTags: { type: [String], default: [] },
    gameUrl: { type: String },
    rnd: { type: Number, required: true },
  },
  { collection: "puzzles", versionKey: false },
);
puzzleSchema.index({ rating: 1, rnd: 1 });
puzzleSchema.index({ themes: 1, rating: 1, rnd: 1 });
puzzleSchema.index({ rnd: 1 });
puzzleSchema.index(
  { rnd: 1, rating: 1 },
  {
    name: "puzzle_daily_pool",
    partialFilterExpression: { popularity: { $gte: 95 }, nbPlays: { $gte: 2000 } },
  },
);

const dailyPuzzleSchema = new Schema(
  {
    _id: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    puzzleId: { type: String, required: true },
  },
  { collection: "dailyPuzzles", versionKey: false },
);

const openingSchema = new Schema(
  {
    _id: { type: String, required: true },
    eco: { type: String, required: true },
    name: { type: String, required: true },
    pgn: { type: String, required: true },
  },
  { collection: "openings", versionKey: false },
);
openingSchema.index({ eco: 1 });

const evalLineSchema = new Schema(
  {
    pv: { type: [String], required: true },
    cp: { type: Number },
    mate: { type: Number },
    depth: { type: Number, required: true },
  },
  { _id: false },
);

const evalCacheSchema = new Schema(
  {
    _id: { type: String, required: true },
    depth: { type: Number, required: true },
    multipv: { type: Number, required: true },
    lines: { type: [evalLineSchema], required: true },
    engine: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "evalCache", versionKey: false },
);
evalCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const sharedGameSchema = new Schema(
  {
    _id: { type: String, required: true },
    pgn: { type: String, required: true, maxlength: 1_000_000 },
    analysis: { type: Schema.Types.Mixed },
    orientation: { type: String, enum: ["white", "black"], default: "white" },
    ownerDeviceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "sharedGames", versionKey: false },
);
sharedGameSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
sharedGameSchema.index({ ownerDeviceId: 1, createdAt: -1 });

export const Puzzle = defineModel("Puzzle", puzzleSchema);
export const DailyPuzzle = defineModel("DailyPuzzle", dailyPuzzleSchema);
export const Opening = defineModel("Opening", openingSchema);
export const EvalCache = defineModel("EvalCache", evalCacheSchema);
export const SharedGame = defineModel("SharedGame", sharedGameSchema);

export const allModels = [Puzzle, DailyPuzzle, Opening, EvalCache, SharedGame] as const;
