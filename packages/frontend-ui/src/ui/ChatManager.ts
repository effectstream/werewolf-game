export class ChatManager {
  private messagesBoxEl: HTMLDivElement
  private chatFormEl: HTMLFormElement
  private chatInputEl: HTMLInputElement

  constructor() {
    this.messagesBoxEl = document.querySelector<HTMLDivElement>('#messagesBox')!
    this.chatFormEl = document.querySelector<HTMLFormElement>('#chatForm')!
    this.chatInputEl = document.querySelector<HTMLInputElement>('#chatInput')!

    this.initEventListeners()
  }

  private initEventListeners() {
    this.chatFormEl.addEventListener('submit', (event) => {
      event.preventDefault()
      const typedMessage = this.chatInputEl.value.trim()
      if (!typedMessage) {
        return
      }
      this.addMessageLine('You', typedMessage)
      this.chatInputEl.value = ''
    })
  }

  public addMessageLine(speaker: string, message: string): void {
    const line = document.createElement('div')
    line.className = 'message-line'
    line.textContent = `[${speaker.toUpperCase()}]: ${message}`
    this.messagesBoxEl.appendChild(line)
    
    while (this.messagesBoxEl.childElementCount > 80) {
      const first = this.messagesBoxEl.firstElementChild
      if (first) this.messagesBoxEl.removeChild(first)
    }
    
    this.messagesBoxEl.scrollTop = this.messagesBoxEl.scrollHeight
  }
}
