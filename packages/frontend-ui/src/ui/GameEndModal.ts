/** Modal shown when the game ends. Displays winner and per-player score breakdown. */

const PARTICIPATION_PTS = 5
const ROUNDS_MULTIPLIER = 10
const WINNING_TEAM_PTS = 50

export interface GameEndOptions {
  winner: 'VILLAGERS' | 'WEREWOLVES' | 'DRAW' | null
  /** Player's role number: 0=villager 1=werewolf 2=seer 3=doctor. undefined = not in game. */
  playerRole: number | undefined
  roundsSurvived: number
  hasEvmAddress: boolean
  onShowLeaderboard?: () => void
}

export class GameEndModal {
  private backdrop: HTMLDivElement

  constructor() {
    this.backdrop = document.createElement('div')
    this.backdrop.id = 'game-end-backdrop'
    this.backdrop.className = 'game-end-backdrop hidden'
    document.body.appendChild(this.backdrop)
  }

  show(opts: GameEndOptions): void {
    const { winner, playerRole, roundsSurvived, hasEvmAddress, onShowLeaderboard } = opts

    const winnerLabel = winner === 'WEREWOLVES'
      ? '🐺 Werewolves Win!'
      : winner === 'VILLAGERS'
        ? '🏡 Villagers Win!'
        : winner === 'DRAW'
          ? '⚖️ Draw — No Winner!'
          : '🏁 Game Over'

    const winnerClass = winner === 'WEREWOLVES'
      ? 'game-end-winner-wolf'
      : winner === 'DRAW'
        ? 'game-end-winner-draw'
        : 'game-end-winner-village'

    let scoreSection = ''
    if (hasEvmAddress && playerRole !== undefined) {
      const onWinningTeam = winner === 'DRAW'
        ? false
        : winner === 'WEREWOLVES'
          ? playerRole === 1
          : playerRole !== 1
      const participationPts = PARTICIPATION_PTS
      const roundsPts = ROUNDS_MULTIPLIER * roundsSurvived
      const winBonus = onWinningTeam ? WINNING_TEAM_PTS : 0
      const total = participationPts + roundsPts + winBonus

      const winRow = onWinningTeam
        ? `<div class="game-end-score-row game-end-score-win">
            <span>Winning Team Bonus</span>
            <span>+${WINNING_TEAM_PTS}</span>
          </div>`
        : `<div class="game-end-score-row game-end-score-dim">
            <span>Winning Team Bonus</span>
            <span>—</span>
          </div>`

      scoreSection = `
        <div class="game-end-divider"></div>
        <div class="game-end-score-title">Your Score This Game</div>
        <div class="game-end-score-rows">
          <div class="game-end-score-row">
            <span>Participation</span>
            <span>+${participationPts}</span>
          </div>
          <div class="game-end-score-row">
            <span>Rounds Survived (${roundsSurvived})</span>
            <span>+${roundsPts}</span>
          </div>
          ${winRow}
          <div class="game-end-score-row game-end-score-total">
            <span>Total</span>
            <span>+${total} pts</span>
          </div>
        </div>`
    } else if (!hasEvmAddress) {
      scoreSection = `
        <div class="game-end-divider"></div>
        <div class="game-end-no-wallet">
          Connect a wallet when joining to earn points on the leaderboard!
        </div>`
    }

    this.backdrop.innerHTML = `
      <div class="game-end-modal" role="dialog" aria-modal="true">
        <div class="game-end-title">GAME OVER</div>
        <div class="game-end-winner ${winnerClass}">${winnerLabel}</div>
        ${scoreSection}
        <div class="game-end-actions">
          <button id="game-end-leaderboard-btn" class="ui-btn">🏆 Leaderboard</button>
          <button id="game-end-close-btn" class="ui-btn">Close</button>
        </div>
      </div>
    `

    this.backdrop.querySelector('#game-end-leaderboard-btn')!
      .addEventListener('click', () => {
        this.hide()
        onShowLeaderboard?.()
      })

    this.backdrop.querySelector('#game-end-close-btn')!
      .addEventListener('click', () => this.hide())

    this.backdrop.classList.remove('hidden')
  }

  hide(): void {
    this.backdrop.classList.add('hidden')
  }
}
