import { gameState } from '../state/gameState'

export class PlayerListManager {
  private playersListEl: HTMLDivElement
  private lastAliveHash: string = ''
  private unsubscribe: () => void

  constructor() {
    this.playersListEl = document.querySelector<HTMLDivElement>('#playersList')!

    this.unsubscribe = gameState.subscribe(() => {
      this.updateHighlights()
      this.rebuildIfNeeded()
    })
  }

  public buildPlayerList(): void {
    const rows = gameState.players
      .map((player, index) => {
        const alive = gameState.playerAlive[index] !== false
        const deadClass = alive ? '' : ' dead'
        const disabledAttr = alive ? '' : ' disabled'

        return `
        <div class="player-row${deadClass}" data-player-index="${index}">
          <span>${player.name}${alive ? '' : ' (dead)'}</span>
          <div class="actions">
            <button class="ui-btn small"${disabledAttr}>VOTE</button>
            <button class="ui-btn small danger"${disabledAttr}>KILL</button>
          </div>
        </div>
      `
      })
      .join('')
    this.playersListEl.innerHTML = rows

    this.lastAliveHash = JSON.stringify(gameState.playerAlive)

    const rowsEls = Array.from(
      this.playersListEl.querySelectorAll<HTMLDivElement>('.player-row')
    )
    rowsEls.forEach((row) => {
      const indexAttr = row.dataset.playerIndex
      const index = indexAttr !== undefined ? Number(indexAttr) : NaN
      if (!Number.isFinite(index)) {
        return
      }
      const player = gameState.players[index]
      if (!player) {
        return
      }
      row.addEventListener('mouseenter', () => {
        gameState.setHoveredPlayer(player)
      })
      row.addEventListener('mouseleave', () => {
        gameState.setHoveredPlayer(null)
      })
    })
  }

  private rebuildIfNeeded(): void {
    const currentHash = JSON.stringify(gameState.playerAlive)
    if (currentHash !== this.lastAliveHash) {
      this.buildPlayerList()
    }
  }

  public destroy(): void {
    this.unsubscribe()
  }

  private updateHighlights(): void {
    const rows = Array.from(
      this.playersListEl.querySelectorAll<HTMLDivElement>('.player-row')
    )
    rows.forEach((row) => {
      const indexAttr = row.dataset.playerIndex
      const index = indexAttr !== undefined ? Number(indexAttr) : NaN
      const shouldHighlight =
        gameState.hoveredPlayer !== null && Number.isFinite(index) && index === gameState.hoveredPlayer.index
      row.classList.toggle('highlighted', shouldHighlight)
    })
  }
}
