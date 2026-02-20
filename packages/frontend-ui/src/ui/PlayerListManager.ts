import { gameState } from '../state/gameState'

export class PlayerListManager {
  private playersListEl: HTMLDivElement

  constructor() {
    this.playersListEl = document.querySelector<HTMLDivElement>('#playersList')!

    gameState.subscribe(() => this.updateHighlights())
  }

  public buildPlayerList(): void {
    const rows = gameState.players
      .map(
        (player, index) => `
        <div class="player-row" data-player-index="${index}">
          <span>${player.name}</span>
          <div class="actions">
            <button class="ui-btn small">VOTE</button>
            <button class="ui-btn small danger">KILL</button>
          </div>
        </div>
      `
      )
      .join('')
    this.playersListEl.innerHTML = rows

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
