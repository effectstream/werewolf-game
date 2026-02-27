import * as THREE from 'three'
import type { PlayerConfig } from '../models/PlayerConfigInterface'
import type { GameViewResponse } from '../services/lobbyApi'

export type Role = 'villager' | 'werewolf' | 'doctor' | 'seer' | 'angelDead'
export type Phase = 'NIGHT' | 'DAY' | 'FINISHED'

export interface PlayerBundle {
  gameId: string
  playerId: number
  leafSecret: string
  merklePath: { sibling: { field: string }; goes_left: boolean }[]
  adminVotePublicKeyHex: string
  role?: number
}

export interface Player extends PlayerConfig {
  index: number
  group: THREE.Group
  activeRole: Role
  activeModel: THREE.Object3D
  roleModels: Partial<Record<Role, THREE.Object3D>>
  bubble: THREE.Sprite
  talkingUntil: number
  speechCooldown: number
}

class GameState {
  players: Player[] = []
  round: number = 1
  phase: Phase = 'NIGHT'
  selectedPlayer: Player | null = null
  hoveredPlayer: Player | null = null
  targetEnvironmentMix: number = 0
  lobbyGameId: number | null = null
  playerEvmAddress: string | null = null
  playerBundle: PlayerBundle | null = null

  /** Per-player alive status, indexed by player_idx */
  playerAlive: boolean[] = []
  /** Whether the game has ended */
  finished: boolean = false
  /** Indices of werewolf players (only populated when finished) */
  werewolfIndices: number[] = []
  /** Player count from the backend */
  backendPlayerCount: number = 0
  /** Total alive count */
  aliveCount: number = 0
  /** Block height of the last game view update */
  lastUpdatedBlock: number = -1

  private listeners: (() => void)[] = []

  subscribe(listener: () => void) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  notify() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  setPhase(phase: Phase) {
    this.phase = phase
    this.targetEnvironmentMix = phase === 'DAY' ? 1 : 0
    this.notify()
  }

  setPlayerBundle(bundle: PlayerBundle) {
    this.playerBundle = bundle
    this.notify()
  }

  setGameStarted() {
    this.setPhase('NIGHT')
  }

  applyGameView(view: GameViewResponse): void {
    let changed = false

    const mappedPhase = this.mapPhase(view.phase)
    if (mappedPhase !== this.phase) {
      this.phase = mappedPhase
      if (mappedPhase === 'DAY') {
        this.targetEnvironmentMix = 1
      } else if (mappedPhase === 'NIGHT') {
        this.targetEnvironmentMix = 0
      }
      // FINISHED keeps current lighting
      changed = true
    }

    if (view.round !== this.round) {
      this.round = view.round
      changed = true
    }

    if (view.finished !== this.finished) {
      this.finished = view.finished
      changed = true
    }

    const newAlive = view.players.map(p => p.alive)
    if (JSON.stringify(newAlive) !== JSON.stringify(this.playerAlive)) {
      this.playerAlive = newAlive
      changed = true
    }

    if (view.aliveCount !== this.aliveCount) {
      this.aliveCount = view.aliveCount
      changed = true
    }

    if (view.playerCount !== this.backendPlayerCount) {
      this.backendPlayerCount = view.playerCount
      changed = true
    }

    if (view.finished && JSON.stringify(view.werewolfIndices) !== JSON.stringify(this.werewolfIndices)) {
      this.werewolfIndices = view.werewolfIndices
      changed = true
    }

    this.lastUpdatedBlock = view.updatedBlock

    if (changed) {
      this.notify()
    }
  }

  private mapPhase(backendPhase: string): Phase {
    const lower = backendPhase.toLowerCase()
    if (lower === 'day') return 'DAY'
    if (lower === 'night') return 'NIGHT'
    if (lower === 'finished') return 'FINISHED'
    return 'DAY'
  }

  incrementRound() {
    this.round += 1
    this.notify()
  }

  setSelectedPlayer(player: Player | null) {
    this.selectedPlayer = player
    this.notify()
  }

  setHoveredPlayer(player: Player | null) {
    if (this.hoveredPlayer === player) return
    
    // Manage scale here as part of state transition
    if (this.hoveredPlayer) {
      this.hoveredPlayer.group.scale.set(1, 1, 1)
    }
    
    this.hoveredPlayer = player
    
    if (this.hoveredPlayer) {
      this.hoveredPlayer.group.scale.set(1.08, 1.08, 1.08)
    }
    
    this.notify()
  }
}

export const gameState = new GameState()
