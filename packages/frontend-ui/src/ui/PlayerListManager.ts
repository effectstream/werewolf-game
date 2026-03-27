import { gameState } from '../state/gameState'
import { submitVote } from '../services/voteService'
import { toastManager } from './ToastManager'
import type { Phase } from '../state/gameState'

const FLAVOR_TEXTS = [
  'The village waits in tense silence…',
  'Shadows gather as the proof is sealed…',
  'Ancient cryptographic wards are being woven…',
  'The night conceals its secrets a little longer…',
  'Evidence is being inscribed into the chain…',
  'The wolves deliberate in the dark…',
]

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
    const localPlayerAlive = gameState.playerAlive[localPlayerIndex] !== false
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
            ${this.getButtonsHtml(index, index === localPlayerIndex, phase, localRole, alive, hasVoted, localPlayerAlive)}
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
    localPlayerAlive: boolean = true,
  ): string {
    if (!alive || isLocalPlayer || phase === 'FINISHED' || !localPlayerAlive) return ''

    // When all votes are in, voting is closed — suppress all action buttons
    if (gameState.allVotesIn) return ''

    const votedHtml = '<button class="ui-btn small vote-btn voted" disabled>✓ Voted</button>'

    if (phase === 'DAY') {
      if (hasVoted) return votedHtml
      return `<button class="ui-btn small accuse-btn vote-btn" data-target-index="${index}">ACCUSE</button>`
    }

    if (phase === 'NIGHT') {
      // Only werewolves (role === 1) can KILL at night
      if (localRole !== 1) return ''
      if (hasVoted) return votedHtml
      return `<button class="ui-btn small danger kill-btn vote-btn" data-target-index="${index}">KILL</button>`
    }

    return ''
  }

  private openVoteModal(targetIndex: number, targetName: string): void {
    const backdrop = document.querySelector<HTMLDivElement>('#voteConfirmBackdrop')!
    const targetNameEl = document.querySelector<HTMLElement>('#voteConfirmTargetName')!
    const yesBtn = document.querySelector<HTMLButtonElement>('#voteConfirmYesBtn')!
    const noBtn = document.querySelector<HTMLButtonElement>('#voteConfirmNoBtn')!

    // TX progress elements
    const txProgress = document.querySelector<HTMLElement>('#voteTxProgress')!
    const txElapsed = document.querySelector<HTMLElement>('#voteTxElapsed')!
    const txFlavor = document.querySelector<HTMLElement>('#voteTxFlavor')!
    const txReassurance = document.querySelector<HTMLElement>('#voteTxReassurance')!
    const stepProving = document.querySelector<HTMLElement>('#vtxStepProving')!
    const stepBatcher = document.querySelector<HTMLElement>('#vtxStepBatcher')!

    targetNameEl.textContent = targetName
    backdrop.classList.remove('hidden')
    backdrop.setAttribute('aria-hidden', 'false')

    // Replace buttons to remove any stale event listeners
    const newYes = yesBtn.cloneNode(true) as HTMLButtonElement
    const newNo = noBtn.cloneNode(true) as HTMLButtonElement
    yesBtn.replaceWith(newYes)
    noBtn.replaceWith(newNo)

    let txTimer: ReturnType<typeof setInterval> | null = null
    let elapsedSeconds = 0

    const setPhase = (phase: 'proving' | 'batcher') => {
      if (phase === 'proving') {
        stepProving.className = 'vote-tx-step vote-tx-step-active'
        stepBatcher.className = 'vote-tx-step'
      } else {
        stepProving.className = 'vote-tx-step vote-tx-step-done'
        stepBatcher.className = 'vote-tx-step vote-tx-step-active'
      }
    }

    const updateTxTimer = (elapsed: number) => {
      txElapsed.textContent = `${elapsed}s elapsed`
      txFlavor.textContent = FLAVOR_TEXTS[Math.floor(elapsed / 15) % FLAVOR_TEXTS.length]
      if (elapsed >= 45) txReassurance.classList.remove('hidden')
    }

    const startTxProgress = () => {
      elapsedSeconds = 0
      setPhase('proving')
      txElapsed.textContent = '0s elapsed'
      txFlavor.textContent = FLAVOR_TEXTS[0]
      txReassurance.classList.add('hidden')
      txProgress.classList.remove('hidden')
      txTimer = setInterval(() => {
        elapsedSeconds++
        updateTxTimer(elapsedSeconds)
      }, 1000)
    }

    const stopTxProgress = () => {
      if (txTimer !== null) {
        clearInterval(txTimer)
        txTimer = null
      }
      txProgress.classList.add('hidden')
    }

    const setLoading = (isLoading: boolean) => {
      newYes.disabled = isLoading
      newNo.disabled = isLoading
      newYes.textContent = isLoading ? 'Submitting…' : 'Confirm'
      if (isLoading) {
        startTxProgress()
      } else {
        stopTxProgress()
      }
    }

    newYes.addEventListener('click', async () => {
      setLoading(true)
      const closed = await this.handleVoteConfirmed(targetIndex, { onProofDone: () => setPhase('batcher') })
      setLoading(false)
      if (closed) {
        backdrop.classList.add('hidden')
        backdrop.setAttribute('aria-hidden', 'true')
      }
    })

    newNo.addEventListener('click', () => {
      stopTxProgress()
      backdrop.classList.add('hidden')
      backdrop.setAttribute('aria-hidden', 'true')
    })
  }

  /**
   * Submits the vote. Returns true if the modal should close (success / already voted),
   * false if the modal should stay open for a retry (error).
   */
  private async handleVoteConfirmed(targetIndex: number, callbacks?: { onProofDone?: () => void }): Promise<boolean> {
    const bundle = gameState.playerBundle
    if (!bundle) {
      console.error('[PlayerListManager] No player bundle available for vote')
      toastManager.error('Vote failed — player bundle missing.')
      return true
    }

    if (gameState.lobbyGameId === null) {
      console.error('[PlayerListManager] No game ID available')
      toastManager.error('Vote failed — no game ID.')
      return true
    }

    try {
      const result = await submitVote(
        bundle,
        targetIndex,
        gameState.round,
        gameState.phase,
        gameState.lobbyGameId,
        callbacks,
      )

      if (result.alreadyVoted) {
        gameState.markVotedThisRound()
        toastManager.info('You already voted this round.')
        console.log('[PlayerListManager] Already voted:', result)
        return true
      }

      if (result.success) {
        gameState.markVotedThisRound()
        toastManager.success('Your vote has been cast ✓')
        console.log('[PlayerListManager] Vote submitted, waiting for others...', result)
        return true
      }

      // Backend returned a failure
      toastManager.error(`Failed to submit vote — ${result.error ?? 'try again.'}`)
      console.error('[PlayerListManager] Vote failed:', result.error)
      return false
    } catch (err) {
      toastManager.error('Failed to submit vote — try again.')
      console.error('[PlayerListManager] Vote submission error:', err)
      return false
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
      allVotesIn: gameState.allVotesIn,
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
