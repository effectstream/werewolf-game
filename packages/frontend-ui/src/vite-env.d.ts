/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend game API base URL — e.g. https://game.yourhost.com */
  readonly VITE_API_URL?: string
  /** Batcher base URL (without /send-input) — e.g. https://batcher.yourhost.com */
  readonly VITE_BATCHER_URL?: string
  /** Chat server WebSocket URL — e.g. wss://chat.yourhost.com */
  readonly VITE_CHAT_SERVER_URL?: string
  /** Midnight network ID — "undeployed" | "preprod" | "mainnet" */
  readonly VITE_MIDNIGHT_NETWORK_ID?: string
  /** Optional base URL for fetching ZK prover parameters (defaults to window.location.origin) */
  readonly VITE_MIDNIGHT_PARAMS_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
