import { gameState } from '../state/gameState'

const ROLE_LABELS: Record<number, string> = {
  0: 'Villager',
  1: 'Werewolf',
  2: 'Seer',
  3: 'Doctor',
}

export class HUDManager {
  private roundLabel: HTMLDivElement
  private phaseLabel: HTMLDivElement
  private revealRoleBtn: HTMLButtonElement
  private maskedRoleBtn: HTMLButtonElement
  private endVoteBtn: HTMLButtonElement
  private roleRevealTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: () => void

  constructor() {
    this.roundLabel = document.querySelector<HTMLDivElement>('#roundLabel')!
    this.phaseLabel = document.querySelector<HTMLDivElement>('#phaseLabel')!
    this.revealRoleBtn = document.querySelector<HTMLButtonElement>('#revealRoleBtn')!
    this.maskedRoleBtn = document.querySelector<HTMLButtonElement>('#maskedRoleBtn')!
    this.endVoteBtn = document.querySelector<HTMLButtonElement>('#endVoteBtn')!

    this.initEventListeners()

    this.unsubscribe = gameState.subscribe(() => this.updatePhaseHud())

    // Initial update
    this.updatePhaseHud()
  }

  private initEventListeners() {
    this.revealRoleBtn.addEventListener('click', () => {
      if (this.roleRevealTimer) {
        clearTimeout(this.roleRevealTimer)
      }
      const roleNum = gameState.playerBundle?.role
      const roleLabel = roleNum !== undefined ? (ROLE_LABELS[roleNum] ?? 'Unknown') : 'Unknown'
      this.maskedRoleBtn.textContent = `You are a ${roleLabel}`
      this.roleRevealTimer = setTimeout(() => {
        this.maskedRoleBtn.textContent = 'You are a ******'
      }, 3000)
    })

    // End vote button is now display-only; phase is driven by polled backend state
    this.endVoteBtn.style.display = 'none'
  }

  private updatePhaseHud() {
    this.roundLabel.textContent = `Round ${gameState.round}`

    if (gameState.finished) {
      this.phaseLabel.textContent = 'GAME OVER'
      this.phaseLabel.classList.remove('day')
    } else {
      this.phaseLabel.textContent = gameState.phase
      this.phaseLabel.classList.toggle('day', gameState.phase === 'DAY')
    }

    const voteBar = document.querySelector<HTMLDivElement>('#voteStatusBar')
    const voteLabel = document.querySelector<HTMLSpanElement>('#voteCountLabel')
    if (voteBar && voteLabel) {
      const showBar =
        (gameState.phase === 'DAY' || gameState.phase === 'NIGHT') &&
        gameState.gameStarted &&
        !gameState.finished &&
        gameState.aliveCount > 0
      voteBar.classList.toggle('hidden', !showBar)
      if (showBar) {
        voteLabel.textContent = `${gameState.voteCount}/${gameState.aliveCount} voted`
      }
    }
  }

  public destroy(): void {
    this.unsubscribe()
    if (this.roleRevealTimer !== null) {
      clearTimeout(this.roleRevealTimer)
      this.roleRevealTimer = null
    }
  }
}
