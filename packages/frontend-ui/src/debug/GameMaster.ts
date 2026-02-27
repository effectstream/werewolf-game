import { gameState } from '../state/gameState'
import type { PlayerEntities } from '../scene/PlayerEntities'

class GameMaster {
  private playerEntities: PlayerEntities | null = null

  _bind(playerEntities: PlayerEntities): void {
    this.playerEntities = playerEntities
  }

  kill(playerIndex: number): void {
    const player = gameState.players[playerIndex]
    if (!player) {
      console.warn(`[gamemaster] No player at index ${playerIndex}`)
      return
    }
    if (gameState.playerAlive[playerIndex] === false) {
      console.warn(`[gamemaster] Player ${player.name} is already dead`)
      return
    }
    gameState.playerAlive[playerIndex] = false
    gameState.notify()
    console.log(`[gamemaster] Killed player ${playerIndex}: ${player.name}`)
  }
}

export const gameMaster = new GameMaster()
