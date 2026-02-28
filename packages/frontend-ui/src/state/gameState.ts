import * as THREE from 'three'
import type { PlayerConfig } from '../models/PlayerConfigInterface'
import type { GameViewResponse } from '../services/lobbyApi'

export type Role = 'villager' | 'werewolf' | 'doctor' | 'seer' | 'angelDead'

const ROLE_NUMBER_MAP: Record<number, Role> = {
  0: 'villager',
  1: 'werewolf',
  2: 'seer',
  3: 'doctor',
}

export function roleNumberToRole(n: number): Role {
  return ROLE_NUMBER_MAP[n] ?? 'villager'
}
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
  playerNickname: string | null = null
  playerBundle: PlayerBundle | null = null
  /** Maps player index → nickname, populated from /api/game_players at boot */
  playerNicknames: Map<number, string> = new Map()

  /** Per-player alive status, indexed by player_idx */
  playerAlive: boolean[] = []
  /** Whether the game has ended */
  finished: boolean = false
  /** Whether the game has started (first valid game view received or last-joiner flag set) */
  gameStarted: boolean = false
  /** Indices of werewolf players (only populated when finished) */
  werewolfIndices: number[] = []
  /** Player count from the backend */
  backendPlayerCount: number = 0
  /** Total alive count */
  aliveCount: number = 0
  /** Block height of the last game view update */
  lastUpdatedBlock: number = -1
  /** Whether the local player has voted in the current round+phase */
  hasVotedThisRound: boolean = false
  /** Number of votes submitted so far this round (from polling) */
  voteCount: number = 0
  /** Internal key to detect round/phase changes for auto-reset */
  private votedRoundPhaseKey: string = ''

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
    this.gameStarted = true
    this.setPhase('NIGHT')
  }

  applyGameView(view: GameViewResponse): void {
    console.log('[gameState] applyGameView called')
    console.log('[gameState] Phase:', view.phase, 'Round:', view.round, 'AliveCount:', view.aliveCount)
    console.log('[gameState] Players alive status:', view.players.map(p => ({ index: p.index, alive: p.alive })))
    console.log('[gameState] Finished:', view.finished)

    let changed = false

    // The Midnight contract stores phase as a numeric enum (1=night, 2=day, 3=finished).
    // The state machine writes String(phase) to the DB, so the frontend receives "1", "2", "3".
    // Also accept text variants for forward-compatibility.
    const isValidPhase = ['night', 'day', 'finished', '1', '2', '3'].includes(view.phase.toLowerCase())
    if (!this.gameStarted && isValidPhase) {
      console.log('[gameState] Setting gameStarted = true (valid phase detected)')
      this.gameStarted = true
      changed = true
    }

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
      console.log('[gameState] Phase changed to:', mappedPhase)
    }

    if (view.round !== this.round) {
      this.round = view.round
      changed = true
      console.log('[gameState] Round changed to:', view.round)
    }

    // Auto-reset hasVotedThisRound when the round or phase changes
    const newVotedKey = `${view.round}:${mappedPhase}`
    if (this.hasVotedThisRound && newVotedKey !== this.votedRoundPhaseKey) {
      this.hasVotedThisRound = false
      this.votedRoundPhaseKey = ''
      changed = true
    }

    if (view.finished !== this.finished) {
      this.finished = view.finished
      changed = true
      console.log('[gameState] Finished changed to:', view.finished)
    }

    const newAlive = view.players.map(p => p.alive)
    if (JSON.stringify(newAlive) !== JSON.stringify(this.playerAlive)) {
      console.log('[gameState] playerAlive changed!')
      console.log('[gameState]   Previous:', this.playerAlive)
      console.log('[gameState]   New:', newAlive)
      this.playerAlive = newAlive
      changed = true
    }

    if (view.aliveCount !== this.aliveCount) {
      console.log('[gameState] aliveCount changed from', this.aliveCount, 'to', view.aliveCount)
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
      console.log('[gameState] notifying listeners (changed=true)')
      this.notify()
    } else {
      console.log('[gameState] no changes, not notifying')
    }
  }

  private mapPhase(backendPhase: string): Phase {
    const lower = backendPhase.toLowerCase()
    if (lower === 'day' || lower === '2') return 'DAY'
    if (lower === 'night' || lower === '1') return 'NIGHT'
    if (lower === 'finished' || lower === '3') return 'FINISHED'
    // Unknown phase (e.g. 'waiting', 'not_started', '0') — preserve current phase
    return this.phase
  }

  incrementRound() {
    this.round += 1
    this.notify()
  }

  setSelectedPlayer(player: Player | null) {
    this.selectedPlayer = player
    this.notify()
  }

  markVotedThisRound() {
    this.hasVotedThisRound = true
    this.votedRoundPhaseKey = `${this.round}:${this.phase}`
    this.notify()
  }

  setVoteCount(count: number) {
    if (count !== this.voteCount) {
      this.voteCount = count
      this.notify()
    }
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
