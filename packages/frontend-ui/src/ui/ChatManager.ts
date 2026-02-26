export class ChatManager {
  private messagesBoxEl: HTMLDivElement
  private chatFormEl: HTMLFormElement
  private chatInputEl: HTMLInputElement
  private ws: WebSocket | null = null
  private playerHash: string | null = null

  constructor() {
    this.messagesBoxEl = document.querySelector<HTMLDivElement>('#messagesBox')!
    this.chatFormEl = document.querySelector<HTMLFormElement>('#chatForm')!
    this.chatInputEl = document.querySelector<HTMLInputElement>('#chatInput')!

    this.initEventListeners()
  }

  public connect(gameId: number, midnightAddressHash: string): void {
    this.playerHash = midnightAddressHash
    const base = (import.meta.env.VITE_CHAT_SERVER_URL as string | undefined)
      ?? 'ws://localhost:3001'
    this.ws = new WebSocket(`${base}/chat/${gameId}`)

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'identify', midnightAddressHash }))
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'message') {
        const label = msg.from === midnightAddressHash ? 'You' : msg.from.slice(0, 10) + '...'
        this.addMessageLine(label, msg.text)
      } else if (msg.type === 'system') {
        this.addMessageLine('System', msg.text)
      } else if (msg.type === 'error') {
        this.addMessageLine('System', msg.message)
      }
    }

    this.ws.onclose = () => {
      this.addMessageLine('System', 'Disconnected from chat.')
    }
  }

  private initEventListeners() {
    this.chatFormEl.addEventListener('submit', (event) => {
      event.preventDefault()
      const typedMessage = this.chatInputEl.value.trim()
      if (!typedMessage) {
        return
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'message', text: typedMessage }))
      } else {
        this.addMessageLine('You', typedMessage)
      }
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
