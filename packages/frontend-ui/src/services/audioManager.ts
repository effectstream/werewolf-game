export interface AudioSettings {
  musicEnabled: boolean
  sfxEnabled: boolean
  currentTrack: string
}

export interface Track {
  file: string
  label: string
}

export const AVAILABLE_TRACKS: readonly Track[] = [
  { file: 'Twelve_Steps_Behind.mp3', label: 'Twelve Steps Behind' },
  { file: 'Whispers_in_the_Frostwood.mp3', label: 'Whispers in the Frostwood' },
]

const STORAGE_KEY = 'werewolf:soundSettings'

const DEFAULT_SETTINGS: AudioSettings = {
  musicEnabled: true,
  sfxEnabled: true,
  currentTrack: 'Twelve_Steps_Behind.mp3',
}

export class AudioManager {
  private backgroundMusic: HTMLAudioElement | null = null
  private wolfHowl: HTMLAudioElement | null = null
  private musicEnabled: boolean = DEFAULT_SETTINGS.musicEnabled
  private sfxEnabled: boolean = DEFAULT_SETTINGS.sfxEnabled
  private currentTrack: string = DEFAULT_SETTINGS.currentTrack

  constructor() {
    this.loadSettings()
  }

  init(): void {
    this.backgroundMusic = new Audio('/' + this.currentTrack)
    this.backgroundMusic.loop = true
    this.backgroundMusic.volume = 0.5

    this.wolfHowl = new Audio('/dragon-studio-a-lone-wolf-cries-359871.mp3')
    this.wolfHowl.volume = 1.0

    this.startMusicOnInteraction()
  }

  private startMusicOnInteraction(): void {
    const handler = () => {
      if (this.musicEnabled) {
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
        const parsed = JSON.parse(raw) as Partial<AudioSettings>
        if (typeof parsed.musicEnabled === 'boolean') this.musicEnabled = parsed.musicEnabled
        if (typeof parsed.sfxEnabled === 'boolean') this.sfxEnabled = parsed.sfxEnabled
        if (typeof parsed.currentTrack === 'string' && AVAILABLE_TRACKS.some((t) => t.file === parsed.currentTrack)) {
          this.currentTrack = parsed.currentTrack
        }
      }
    } catch {
    }
  }

  private saveSettings(): void {
    try {
      const settings: AudioSettings = {
        musicEnabled: this.musicEnabled,
        sfxEnabled: this.sfxEnabled,
        currentTrack: this.currentTrack,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
    }
  }

  setMusicEnabled(v: boolean): void {
    this.musicEnabled = v
    if (v) {
      this.backgroundMusic?.play().catch(() => {})
    } else {
      this.backgroundMusic?.pause()
    }
    this.saveSettings()
  }

  setSfxEnabled(v: boolean): void {
    this.sfxEnabled = v
    this.saveSettings()
  }

  setTrack(filename: string): void {
    if (!AVAILABLE_TRACKS.some((t) => t.file === filename)) return
    this.currentTrack = filename
    if (this.backgroundMusic) {
      const wasPlaying = !this.backgroundMusic.paused
      this.backgroundMusic.src = '/' + filename
      this.backgroundMusic.load()
      if (wasPlaying && this.musicEnabled) {
        this.backgroundMusic.play().catch(() => {})
      }
    }
    this.saveSettings()
  }

  getSettings(): AudioSettings {
    return {
      musicEnabled: this.musicEnabled,
      sfxEnabled: this.sfxEnabled,
      currentTrack: this.currentTrack,
    }
  }

  playWolfHowl(): void {
    if (this.sfxEnabled && this.wolfHowl) {
      this.wolfHowl.currentTime = 0
      this.wolfHowl.play().catch(() => {})
    }
  }

  destroy(): void {
    this.backgroundMusic?.pause()
    this.backgroundMusic = null
    this.wolfHowl = null
  }
}
