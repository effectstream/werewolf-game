import { gameState } from '../state/gameState'

export class HUDManager {
  private roundLabel: HTMLDivElement
  private phaseLabel: HTMLDivElement
  private revealRoleBtn: HTMLButtonElement
  private maskedRoleBtn: HTMLButtonElement
  private endVoteBtn: HTMLButtonElement
  private roleRevealTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.roundLabel = document.querySelector<HTMLDivElement>('#roundLabel')!
    this.phaseLabel = document.querySelector<HTMLDivElement>('#phaseLabel')!
    this.revealRoleBtn = document.querySelector<HTMLButtonElement>('#revealRoleBtn')!
    this.maskedRoleBtn = document.querySelector<HTMLButtonElement>('#maskedRoleBtn')!
    this.endVoteBtn = document.querySelector<HTMLButtonElement>('#endVoteBtn')!

    this.initEventListeners()
    
    // Subscribe to state changes to update the HUD
    gameState.subscribe(() => this.updatePhaseHud())
    
    // Initial update
    this.updatePhaseHud()
  }

  private initEventListeners() {
    this.revealRoleBtn.addEventListener('click', () => {
      if (this.roleRevealTimer) {
        clearTimeout(this.roleRevealTimer)
      }
      this.maskedRoleBtn.textContent = 'You are a WEREWOLF'
      this.roleRevealTimer = setTimeout(() => {
        this.maskedRoleBtn.textContent = 'You are a ******'
      }, 3000)
    })

    this.endVoteBtn.addEventListener('click', () => {
      if (gameState.phase === 'NIGHT') {
        gameState.setPhase('DAY')
        gameState.incrementRound()
      } else {
        gameState.setPhase('NIGHT')
      }
    })
  }

  private updatePhaseHud() {
    this.roundLabel.textContent = `Round ${gameState.round}`
    this.phaseLabel.textContent = gameState.phase
    this.phaseLabel.classList.toggle('day', gameState.phase === 'DAY')
  }
}
