import { gameState, Player, Role } from '../state/gameState'

export class RolePicker {
  private backdropEl: HTMLDivElement
  private roleOptionButtons: HTMLButtonElement[]
  private keydownHandler: (event: KeyboardEvent) => void

  public onRoleSelected?: (player: Player, role: Role) => void

  constructor() {
    this.backdropEl = document.querySelector<HTMLDivElement>('#rolePickerBackdrop')!
    this.roleOptionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.role-option-btn'))
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !this.backdropEl.classList.contains('hidden')) {
        this.close()
      }
    }

    this.initEventListeners()
  }

  private initEventListeners() {
    this.backdropEl.addEventListener('click', (event) => {
      if (event.target === this.backdropEl) {
        this.close()
      }
    })

    this.roleOptionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!gameState.selectedPlayer) {
          return
        }
        const selectedRole = button.dataset.role as Role | undefined
        if (selectedRole && this.onRoleSelected) {
          this.onRoleSelected(gameState.selectedPlayer, selectedRole)
        }
        this.close()
      })
    })

    window.addEventListener('keydown', this.keydownHandler)
  }

  public open(player: Player): void {
    gameState.setSelectedPlayer(player)
    this.roleOptionButtons.forEach((button) => {
      const isActive = button.dataset.role === player.activeRole
      button.classList.toggle('active', isActive)
    })
    this.backdropEl.classList.remove('hidden')
    this.backdropEl.setAttribute('aria-hidden', 'false')
  }

  public close(): void {
    gameState.setSelectedPlayer(null)
    this.backdropEl.classList.add('hidden')
    this.backdropEl.setAttribute('aria-hidden', 'true')
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.keydownHandler)
  }
}
