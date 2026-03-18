export type SoundState = 'MUSIC_SOUNDFX' | 'SOUNDFX_ONLY' | 'MUTED'

const STORAGE_KEY = 'werewolf:soundSettings'

interface SoundSettings {
  soundState: SoundState
}

export class AudioManager {
  private backgroundMusic: HTMLAudioElement | null = null
  private wolfHowl: HTMLAudioElement | null = null
  private soundState: SoundState = 'MUSIC_SOUNDFX'
  private soundButton: HTMLButtonElement | null = null
  private boundToggle: (() => void) | null = null

  constructor() {
    this.loadSettings()
  }

  init(): void {
    this.backgroundMusic = new Audio('/Whispers_in_the_Frostwood.mp3')
    this.backgroundMusic.loop = true
    this.backgroundMusic.volume = 0.5

    this.wolfHowl = new Audio('/dragon-studio-a-lone-wolf-cries-359871.mp3')
    this.wolfHowl.volume = 1.0

    this.soundButton = document.querySelector<HTMLButtonElement>('#soundToggleBtn')

    if (this.soundButton) {
      this.boundToggle = () => this.toggleSound()
      this.soundButton.addEventListener('click', this.boundToggle)
      this.updateButtonAppearance()
    }

    this.startMusicOnInteraction()
  }

  private startMusicOnInteraction(): void {
    const handler = () => {
      if (this.soundState === 'MUSIC_SOUNDFX') {
        this.backgroundMusic?.play().catch(() => {})
      }
    }
    document.addEventListener('click', handler, { capture: true, once: true })
    document.addEventListener('keydown', handler, { capture: true, once: true })
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const settings = JSON.parse(raw) as SoundSettings
        if (this.isValidSoundState(settings.soundState)) {
          this.soundState = settings.soundState
        }
      }
    } catch {
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ soundState: this.soundState }))
    } catch {
    }
  }

  private isValidSoundState(state: string): state is SoundState {
    return state === 'MUSIC_SOUNDFX' || state === 'SOUNDFX_ONLY' || state === 'MUTED'
  }

  private applySoundState(): void {
    switch (this.soundState) {
      case 'MUSIC_SOUNDFX':
        this.backgroundMusic?.play().catch(() => {})
        break
      case 'SOUNDFX_ONLY':
      case 'MUTED':
        this.backgroundMusic?.pause()
        break
    }
  }

  toggleSound(): void {
    const states: SoundState[] = ['MUSIC_SOUNDFX', 'SOUNDFX_ONLY', 'MUTED']
    const currentIndex = states.indexOf(this.soundState)
    this.soundState = states[(currentIndex + 1) % states.length]
    this.applySoundState()
    this.updateButtonAppearance()
    this.saveSettings()
  }

  private updateButtonAppearance(): void {
    if (!this.soundButton) return

    const icon = this.soundButton.querySelector('.sound-icon')
    if (!icon) return

    this.soundButton.className = 'sound-toggle-btn'

    switch (this.soundState) {
      case 'MUSIC_SOUNDFX':
        icon.textContent = '🎵🔊'
        break
      case 'SOUNDFX_ONLY':
        icon.textContent = '🔊'
        break
      case 'MUTED':
        icon.textContent = '🔇'
        this.soundButton.classList.add('muted')
        break
    }
  }

  playWolfHowl(): void {
    if (this.soundState !== 'MUTED' && this.wolfHowl) {
      this.wolfHowl.currentTime = 0
      this.wolfHowl.play().catch(() => {})
    }
  }

  getSoundState(): SoundState {
    return this.soundState
  }

  destroy(): void {
    this.backgroundMusic?.pause()
    this.backgroundMusic = null
    this.wolfHowl = null
    if (this.soundButton && this.boundToggle) {
      this.soundButton.removeEventListener('click', this.boundToggle)
    }
    this.soundButton = null
    this.boundToggle = null
  }
}
