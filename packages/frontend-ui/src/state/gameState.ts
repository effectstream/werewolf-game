import * as THREE from 'three'
import type { PlayerConfig } from '../models/PlayerConfigInterface'

export type Role = 'villager' | 'werewolf' | 'doctor' | 'seer' | 'angelDead'
export type Phase = 'NIGHT' | 'DAY'

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
