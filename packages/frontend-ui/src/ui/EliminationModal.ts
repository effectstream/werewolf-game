export type Killer = 'WEREWOLVES' | 'VILLAGERS'

export class EliminationModal {
  private backdrop: HTMLDivElement

  constructor() {
    this.backdrop = document.createElement('div')
    this.backdrop.id = 'elimination-backdrop'
    this.backdrop.className = 'elimination-backdrop hidden'
    document.body.appendChild(this.backdrop)
  }

  show(killer: Killer): void {
    const who = killer === 'WEREWOLVES' ? 'werewolves' : 'villagers'
    this.backdrop.innerHTML = `
      <div class="elimination-modal" role="dialog" aria-modal="true" aria-labelledby="eliminationTitle">
        <div class="elimination-skull">💀</div>
        <h3 id="eliminationTitle" class="elimination-title">You've been eliminated</h3>
        <p class="elimination-body">
          The <strong>${who}</strong> have voted to kill you.
        </p>
        <p class="elimination-body elimination-body-dim">
          You can keep chatting with the other players — sit back and see who wins.
        </p>
        <div class="elimination-actions">
          <button id="eliminationCloseBtn" class="ui-btn">Got it</button>
        </div>
      </div>
    `
    this.backdrop.querySelector('#eliminationCloseBtn')!
      .addEventListener('click', () => this.hide())
    this.backdrop.classList.remove('hidden')
  }

  hide(): void {
    this.backdrop.classList.add('hidden')
  }

  destroy(): void {
    this.backdrop.remove()
  }
}
