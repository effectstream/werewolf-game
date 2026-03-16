import {
  fetchGameView,
  fetchVoteStatus,
  type GameViewResponse,
} from "./lobbyApi";
import { gameState } from "../state/gameState";

export type GameViewCallback = (view: GameViewResponse) => void;

export class GameViewPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private gameId: number;
  private intervalMs: number;
  private callback: GameViewCallback;
  private lastUpdatedBlock: number = -1;

  constructor(
    gameId: number,
    callback: GameViewCallback,
    intervalMs: number = 6000,
  ) {
    this.gameId = gameId;
    this.callback = callback;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.intervalId !== null) return;

    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const view = await fetchGameView(this.gameId);
      console.log('[GameViewPoller] Poll received - Block:', view.updatedBlock, 'Phase:', view.phase, 'Round:', view.round, 'AliveCount:', view.aliveCount)

      if (view.updatedBlock !== this.lastUpdatedBlock) {
        console.log('[GameViewPoller] Block changed - calling callback')
        this.lastUpdatedBlock = view.updatedBlock;
        this.callback(view);
      } else {
        console.log('[GameViewPoller] Block unchanged, skipping callback')
      }
    } catch (err) {
      console.warn("[GameViewPoller] poll failed:", err);
    }
  }
}

export class VoteStatusPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private gameId: number,
    private getRoundPhase: () => { round: number; phase: string },
    private intervalMs: number = 3000,
  ) {}

  start(): void {
    if (this.intervalId !== null) return;
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    const { round, phase } = this.getRoundPhase();
    if (phase === "FINISHED") return;
    try {
      const status = await fetchVoteStatus(this.gameId, round, phase);
      gameState.setVoteCount(status.voteCount);
    } catch (err) {
      console.warn("[VoteStatusPoller] poll failed:", err);
    }
  }
}
