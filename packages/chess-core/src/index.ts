// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  aggregatePrecision,
  moveAccuracy,
  movePrecision,
  precisionComplexityWeight,
} from "./accuracy";
export {
  BOTS,
  type BotLevel,
  type BotPersona,
  botById,
  humanLikeMistakeMove,
  pickBotMove,
  randomLegalMove,
} from "./bots";
export * from "./constants";
export { explainMove, type Outlook, outlook, type PieceName, type Reason, type TacticMotif } from "./explain";
export { type EndReason, type GameOver, type GameResult, gameStatus } from "./game-status";
export {
  addMove,
  clockFromComments,
  createTree,
  deleteFrom,
  type GameTree,
  type InvalidPositionCode,
  InvalidPositionError,
  type MoveNode,
  mainlineFrom,
  nodeAtPath,
  nodesAlongPath,
  positionFromFen,
  promoteVariation,
  type TreePath,
  treeFromPgn,
  treeToPgn,
  uciLineToSan,
} from "./game-tree";
export { GLICKO_DEFAULT, type GlickoRating, type GlickoResult, glicko2Update } from "./glicko2";
export { PERFORMANCE_KNOTS, PERFORMANCE_KNOTS_BY_TIME, PERFORMANCE_SAMPLE_SIZE } from "./performance-table";
export {
  isLegalPv,
  isTablebasePosition,
  mainlineLength,
  normalizeFen,
  pgnFromUciMoves,
  pieceCount,
  TABLEBASE_MAX_PIECES,
} from "./position-utils";
export {
  type PracticeGoal,
  type PracticeState,
  type PracticeStatus,
  playerMoves,
  practiceStatus,
} from "./practice";
export {
  anchoredPerformance,
  criticalPositions,
  detectPhases,
  type EngineLine,
  estimatePerformance,
  type GameReview,
  gameAccuracy,
  MOVE_CLASSES,
  type MoveClass,
  type MoveReview,
  type Phase,
  type PlayerSummary,
  type ReviewInput,
  type ReviewMove,
  type ReviewPosition,
  reviewGame,
  volatilityWeights,
} from "./review";
export { SEE_VALUE, seeGe, seeValue } from "./see";
export type { Color, Score } from "./types";
export {
  labelWinFromScore,
  winPercentCheckmated,
  winPercentFor,
  winPercentFromCp,
  winPercentFromScore,
} from "./win-percent";
