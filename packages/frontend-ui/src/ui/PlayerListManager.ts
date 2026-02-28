import { gameState } from '../state/gameState'
import { submitVote } from '../services/voteService'
import type { Phase } from '../state/gameState'

export class PlayerListManager {
  private playersListEl: HTMLDivElement
  private lastStateHash: string = ''
  private unsubscribe: () => void

  constructor() {
    this.playersListEl = document.querySelector<HTMLDivElement>('#playersList')!

    this.unsubscribe = gameState.subscribe(() => {
      this.updateHighlights()
      this.rebuildIfNeeded()
    })

    // Delegated click listener for ACCUSE/KILL buttons
    this.playersListEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const btn = target.closest('.accuse-btn, .kill-btn') as HTMLElement | null
      if (!btn) return

      const targetIndexStr = btn.dataset.targetIndex
      const targetIndex = targetIndexStr !== undefined ? Number(targetIndexStr) : NaN
      if (!Number.isFinite(targetIndex)) return

      const targetPlayer = gameState.players[targetIndex]
      if (!targetPlayer) return

      const targetName = gameState.playerNicknames.get(targetIndex) ?? targetPlayer.name
      this.openVoteModal(targetIndex, targetName)
    })
  }

  public buildPlayerList(): void {
    const localPlayerIndex = gameState.playerBundle?.playerId ?? -1
    const localRole = gameState.playerBundle?.role
    const phase = gameState.phase
    const hasVoted = gameState.hasVotedThisRound

    const rows = gameState.players
      .map((player, index) => {
        const alive = gameState.playerAlive[index] !== false
        const deadClass = alive ? '' : ' dead'
        const displayName = gameState.playerNicknames.get(index) ?? '?'

        return `
        <div class="player-row${deadClass}" data-player-index="${index}">
          <span>${displayName}${alive ? '' : ' (dead)'}</span>
          <div class="actions">
            ${this.getButtonsHtml(index, index === localPlayerIndex, phase, localRole, alive, hasVoted)}
          </div>
        </div>
      `
      })
      .join('')
    this.playersListEl.innerHTML = rows

    this.lastStateHash = this.buildStateHash()

    const rowsEls = Array.from(
      this.playersListEl.querySelectorAll<HTMLDivElement>('.player-row')
    )
    rowsEls.forEach((row) => {
      const indexAttr = row.dataset.playerIndex
      const index = indexAttr !== undefined ? Number(indexAttr) : NaN
      if (!Number.isFinite(index)) return
      const player = gameState.players[index]
      if (!player) return
      row.addEventListener('mouseenter', () => {
        gameState.setHoveredPlayer(player)
      })
      row.addEventListener('mouseleave', () => {
        gameState.setHoveredPlayer(null)
      })
    })
  }

  private getButtonsHtml(
    index: number,
    isLocalPlayer: boolean,
    phase: Phase,
    localRole: number | undefined,
    alive: boolean,
    hasVoted: boolean,
  ): string {
    if (!alive || isLocalPlayer || phase === 'FINISHED') return ''

    const votedHtml = '<button class="ui-btn small" disabled>Voted</button>'

    if (phase === 'DAY') {
      if (hasVoted) return votedHtml
      return `<button class="ui-btn small accuse-btn" data-target-index="${index}">ACCUSE</button>`
    }

    if (phase === 'NIGHT') {
      // Only werewolves (role === 1) can KILL at night
      if (localRole !== 1) return ''
      if (hasVoted) return votedHtml
      return `<button class="ui-btn small danger kill-btn" data-target-index="${index}">KILL</button>`
    }

    return ''
  }

  private openVoteModal(targetIndex: number, targetName: string): void {
    const backdrop = document.querySelector<HTMLDivElement>('#voteConfirmBackdrop')!
    const targetNameEl = document.querySelector<HTMLElement>('#voteConfirmTargetName')!
    const yesBtn = document.querySelector<HTMLButtonElement>('#voteConfirmYesBtn')!
    const noBtn = document.querySelector<HTMLButtonElement>('#voteConfirmNoBtn')!

    targetNameEl.textContent = targetName
    backdrop.classList.remove('hidden')
    backdrop.setAttribute('aria-hidden', 'false')

    // Replace buttons to remove any stale event listeners
    const newYes = yesBtn.cloneNode(true) as HTMLButtonElement
    const newNo = noBtn.cloneNode(true) as HTMLButtonElement
    yesBtn.replaceWith(newYes)
    noBtn.replaceWith(newNo)

    newYes.addEventListener('click', async () => {
      backdrop.classList.add('hidden')
      backdrop.setAttribute('aria-hidden', 'true')
      await this.handleVoteConfirmed(targetIndex)
    })

    newNo.addEventListener('click', () => {
      backdrop.classList.add('hidden')
      backdrop.setAttribute('aria-hidden', 'true')
    })
  }

  private async handleVoteConfirmed(targetIndex: number): Promise<void> {
    const bundle = gameState.playerBundle
    if (!bundle) {
      console.error('[PlayerListManager] No player bundle available for vote')
      return
    }

    if (gameState.lobbyGameId === null) {
      console.error('[PlayerListManager] No game ID available')
      return
    }

    try {
      const result = await submitVote(
        bundle,
        targetIndex,
        gameState.round,
        gameState.phase,
        gameState.lobbyGameId,
      )

      if (result.success || result.alreadyVoted) {
        gameState.markVotedThisRound()
        console.log('[PlayerListManager] Vote submitted, waiting for others...', result)
      } else {
        console.error('[PlayerListManager] Vote failed:', result.error)
      }
    } catch (err) {
      console.error('[PlayerListManager] Vote submission error:', err)
    }
  }

  private rebuildIfNeeded(): void {
    const currentHash = this.buildStateHash()
    if (currentHash !== this.lastStateHash) {
      this.buildPlayerList()
    }
  }

  private buildStateHash(): string {
    return JSON.stringify({
      alive: gameState.playerAlive,
      phase: gameState.phase,
      round: gameState.round,
      hasVoted: gameState.hasVotedThisRound,
      localRole: gameState.playerBundle?.role,
    })
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
