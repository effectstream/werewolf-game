type ToastType = 'success' | 'error' | 'info'

interface ToastOptions {
  duration?: number // ms before auto-dismiss
}

export class ToastManager {
  private container: HTMLDivElement | null = null

  /** Lazily create the container the first time a toast is shown */
  private getContainer(): HTMLDivElement {
    if (!this.container) {
      this.container = document.querySelector<HTMLDivElement>('#toastContainer')
      if (!this.container) {
        // fallback: inject into body if Layout.ts hasn't added it yet
        this.container = document.createElement('div')
        this.container.id = 'toastContainer'
        document.body.appendChild(this.container)
      }
    }
    return this.container
  }

  private show(message: string, type: ToastType, opts: ToastOptions = {}): void {
    const { duration = 3500 } = opts
    const container = this.getContainer()

    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.setAttribute('role', 'alert')
    toast.setAttribute('aria-live', 'polite')
    toast.textContent = message
    container.appendChild(toast)

    // Trigger slide-in on next frame
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible')
    })

    const dismiss = () => {
      toast.classList.remove('toast-visible')
      toast.classList.add('toast-hiding')
      toast.addEventListener('transitionend', () => toast.remove(), { once: true })
    }

    const timer = setTimeout(dismiss, duration)
    toast.addEventListener('click', () => {
      clearTimeout(timer)
      dismiss()
    })
  }

  success(message: string, opts?: ToastOptions): void {
    this.show(message, 'success', opts)
  }

  error(message: string, opts?: ToastOptions): void {
    this.show(message, 'error', opts)
  }

  info(message: string, opts?: ToastOptions): void {
    this.show(message, 'info', opts)
  }
}

/** Singleton instance exported for use across the app */
export const toastManager = new ToastManager()
