import { fetchGameView, type GameViewResponse } from './lobbyApi'

export type GameViewCallback = (view: GameViewResponse) => void

export class GameViewPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private gameId: number
  private intervalMs: number
  private callback: GameViewCallback
  private lastUpdatedBlock: number = -1

  constructor(gameId: number, callback: GameViewCallback, intervalMs: number = 3000) {
    this.gameId = gameId
    this.callback = callback
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.intervalId !== null) return

    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.intervalMs)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private async poll(): Promise<void> {
    try {
      const view = await fetchGameView(this.gameId)

      if (view.updatedBlock !== this.lastUpdatedBlock) {
        this.lastUpdatedBlock = view.updatedBlock
        this.callback(view)
      }
    } catch (err) {
      console.warn('[GameViewPoller] poll failed:', err)
    }
  }
}
