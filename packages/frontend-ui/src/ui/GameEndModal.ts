/** Modal shown when the game ends. Displays winner, score breakdown, and leaderboard. */

import { deriveNicknameFromMidnightAddress } from '../services/nicknameGenerator.ts'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:9999'

const PARTICIPATION_PTS = 5
const ROUNDS_MULTIPLIER = 10
const WINNING_TEAM_PTS = 50

interface LeaderboardEntry {
  midnight_address: string
  total_points: string
  games_played: number
  games_won: number
  rounds_survived: number
}

export interface GameEndOptions {
  winner: 'VILLAGERS' | 'WEREWOLVES' | 'DRAW' | null
  /** Player's role number: 0=villager 1=werewolf 2=seer 3=doctor. undefined = not in game. */
  playerRole: number | undefined
  roundsSurvived: number
  hasEvmAddress: boolean
  onReturnToLobby?: () => void
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
    const { winner, playerRole, roundsSurvived, hasEvmAddress, onReturnToLobby } = opts

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
        <div class="game-end-divider"></div>
        <div class="game-end-leaderboard-section">
          <div class="game-end-score-title">🏆 Leaderboard</div>
          <div class="game-end-leaderboard-scroll">
            <table class="game-end-leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nickname</th>
                  <th>Address</th>
                  <th>Points</th>
                  <th>W/P</th>
                  <th>Rounds</th>
                </tr>
              </thead>
              <tbody id="game-end-leaderboard-tbody">
                <tr><td colspan="6" class="game-end-leaderboard-loading">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="game-end-actions">
          <button id="game-end-lobby-btn" class="ui-btn game-end-lobby-btn">← Return to Lobby</button>
          <button id="game-end-close-btn" class="ui-btn">Close</button>
        </div>
      </div>
    `

    this.backdrop.querySelector('#game-end-lobby-btn')!
      .addEventListener('click', () => {
        this.hide()
        onReturnToLobby?.()
      })

    this.backdrop.querySelector('#game-end-close-btn')!
      .addEventListener('click', () => this.hide())

    this.backdrop.classList.remove('hidden')

    this.fetchLeaderboard()
  }

  hide(): void {
    this.backdrop.classList.add('hidden')
  }

  private async fetchLeaderboard(): Promise<void> {
    const tbody = this.backdrop.querySelector<HTMLTableSectionElement>('#game-end-leaderboard-tbody')
    if (!tbody) return

    try {
      const res = await fetch(`${API_BASE}/api/leaderboard?limit=50&offset=0`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: { entries: LeaderboardEntry[] } = await res.json()

      if (data.entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="game-end-leaderboard-loading">No entries yet.</td></tr>`
        return
      }

      tbody.innerHTML = data.entries
        .map((e, i) => {
          const addr = e.midnight_address
          const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`
          const pts = Number(e.total_points).toLocaleString()
          const nickname = deriveNicknameFromMidnightAddress(addr)
          return `<tr>
            <td class="lb-rank">${i + 1}</td>
            <td class="lb-nick">${nickname}</td>
            <td class="lb-addr" title="${addr}">${short}</td>
            <td class="lb-pts">${pts}</td>
            <td class="lb-wins">${e.games_won}/${e.games_played}</td>
            <td class="lb-rounds">${e.rounds_survived}</td>
          </tr>`
        })
        .join('')
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="game-end-leaderboard-loading">Failed to load leaderboard.</td></tr>`
      console.warn('[game-end] leaderboard fetch failed:', err)
    }
  }
}
