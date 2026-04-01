import { AudioManager, AVAILABLE_TRACKS } from '../services/audioManager'

export class AudioSettingsModal {
  private backdropEl: HTMLDivElement
  private soundButton: HTMLButtonElement
  private keydownHandler: (e: KeyboardEvent) => void
  private boundOpenModal: () => void

  constructor(private audioManager: AudioManager) {
    this.backdropEl = document.querySelector<HTMLDivElement>('#audioSettingsBackdrop')!
    this.soundButton = document.querySelector<HTMLButtonElement>('#soundToggleBtn')!

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.backdropEl.classList.contains('hidden')) {
        this.close()
      }
    }

    this.boundOpenModal = () => this.open()

    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) this.close()
    })
    window.addEventListener('keydown', this.keydownHandler)
    this.soundButton.addEventListener('click', this.boundOpenModal)

    this.buildTrackButtons()
    this.initInnerListeners()
    this.syncButtonIcon()
  }

  private buildTrackButtons(): void {
    const list = this.backdropEl.querySelector<HTMLDivElement>('#audioTrackList')
    if (!list) return
    list.innerHTML = ''
    for (const track of AVAILABLE_TRACKS) {
      const btn = document.createElement('button')
      btn.className = 'ui-btn small audio-track-btn'
      btn.dataset.track = track.file
      btn.textContent = track.label
      list.appendChild(btn)
    }
  }

  open(): void {
    this.syncModalState()
    this.backdropEl.classList.remove('hidden')
    this.backdropEl.setAttribute('aria-hidden', 'false')
  }

  close(): void {
    this.backdropEl.classList.add('hidden')
    this.backdropEl.setAttribute('aria-hidden', 'true')
  }

  destroy(): void {
    this.soundButton.removeEventListener('click', this.boundOpenModal)
    window.removeEventListener('keydown', this.keydownHandler)
  }

  private syncModalState(): void {
    const settings = this.audioManager.getSettings()

    const musicToggle = this.backdropEl.querySelector<HTMLInputElement>('#audioMusicToggle')
    if (musicToggle) musicToggle.checked = settings.musicEnabled

    const sfxToggle = this.backdropEl.querySelector<HTMLInputElement>('#audioSfxToggle')
    if (sfxToggle) sfxToggle.checked = settings.sfxEnabled

    const trackBtns = this.backdropEl.querySelectorAll<HTMLButtonElement>('.audio-track-btn')
    trackBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.track === settings.currentTrack)
    })
  }

  syncButtonIcon(): void {
    const settings = this.audioManager.getSettings()
    const icon = this.soundButton.querySelector('.sound-icon')
    if (!icon) return

    this.soundButton.classList.remove('muted', 'music-off')

    if (!settings.musicEnabled && !settings.sfxEnabled) {
      icon.textContent = '🔇'
      this.soundButton.classList.add('muted')
    } else if (!settings.musicEnabled) {
      icon.textContent = '🔊'
      this.soundButton.classList.add('music-off')
    } else {
      icon.textContent = '🎵'
    }
  }

  private initInnerListeners(): void {
    const musicToggle = this.backdropEl.querySelector<HTMLInputElement>('#audioMusicToggle')
    const sfxToggle = this.backdropEl.querySelector<HTMLInputElement>('#audioSfxToggle')
    const trackBtns = this.backdropEl.querySelectorAll<HTMLButtonElement>('.audio-track-btn')
    const closeBtn = this.backdropEl.querySelector<HTMLButtonElement>('#audioSettingsCloseBtn')

    musicToggle?.addEventListener('change', () => {
      this.audioManager.setMusicEnabled(musicToggle.checked)
      this.syncButtonIcon()
    })

    sfxToggle?.addEventListener('change', () => {
      this.audioManager.setSfxEnabled(sfxToggle.checked)
      this.syncButtonIcon()
    })

    trackBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const track = btn.dataset.track
        if (!track) return
        this.audioManager.setTrack(track)
        trackBtns.forEach((b) => b.classList.toggle('active', b.dataset.track === track))
      })
    })

    closeBtn?.addEventListener('click', () => this.close())
  }
}
