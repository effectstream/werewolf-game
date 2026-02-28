import * as THREE from 'three'
import { gameState, Player, Role } from '../state/gameState'
import { createPlayerMesh } from '../models/playerModel'
import { createDoctorMesh } from '../models/doctorModel'
import { createSeerMesh } from '../models/seerModel'
import { createWerewolfMesh } from '../models/werewolfModel'
import { createAngelMesh } from '../models/angelModel'
import { makeTextSprite, makeBubbleSprite, createBubbleTexture } from '../utils/spriteUtils'
import { generatePlayerConfigs, generateHairParameters } from '../utils/playerGenerator'
import type { PlayerConfig } from '../models/PlayerConfigInterface'
import type { ChatManager } from '../ui/ChatManager'

export class PlayerEntities {
  private scene: THREE.Scene
  private chatManager: ChatManager
  private unsubscribe: () => void
  private nameSprites: Map<number, THREE.Sprite> = new Map()
  private resolvedNames: Map<number, string> = new Map()

  private readonly ROLE_ORDER: Role[] = ['villager', 'werewolf', 'doctor', 'seer', 'angelDead']
  private readonly ROLE_LABEL: Record<Role, string> = {
    villager: 'Villager',
    werewolf: 'Werewolf',
    doctor: 'Doctor',
    seer: 'Seer',
    angelDead: 'Angel (dead)'
  }

  constructor(scene: THREE.Scene, chatManager: ChatManager, playerCount: number, updateCardLayout?: (count: number) => void) {
    this.scene = scene
    this.chatManager = chatManager

    this.initPlayers(playerCount, updateCardLayout)

    this.unsubscribe = gameState.subscribe(() => this.syncVisuals())
  }

  private initPlayers(playerCount: number, updateCardLayout?: (count: number) => void) {
    const seed = 42

    const basePlayerConfigs = generatePlayerConfigs(playerCount, seed)
    const selectedPlayers: PlayerConfig[] = basePlayerConfigs.map((base, index) => {
      const hairParams = generateHairParameters(seed + index * 1000)
      return {
        ...base,
        hairWidth: hairParams.hairWidth,
        hairHeight: hairParams.hairHeight,
        hairDepth: hairParams.hairDepth,
        hasBun: hairParams.hasBun,
        bunSize: hairParams.bunSize
      }
    })

    if (updateCardLayout) {
      updateCardLayout(playerCount)
    }

    const playerRadius = 5.4

    selectedPlayers.forEach((playerConfig, index) => {
      const t = index === 0 ? 0.00001 : index / (playerCount - 1)
      const angle = Math.PI + t * Math.PI
      const x = Math.cos(angle) * playerRadius
      const z = Math.sin(angle) * playerRadius

      const playerGroup = new THREE.Group()
      playerGroup.position.set(x, 0, z)
      playerGroup.rotation.y = Math.atan2(-x, -z)
      this.scene.add(playerGroup)

      const basePlayerMesh = createPlayerMesh(playerConfig)
      this.markModelAsPickable(basePlayerMesh, index)
      playerGroup.add(basePlayerMesh)

      const displayName = gameState.playerNicknames.get(index) ?? '?'
      const nameSprite = makeTextSprite(displayName, { color: '#d9e0ff', scale: 1.4 })
      nameSprite.position.set(0, 0.12, 0)
      playerGroup.add(nameSprite)
      this.nameSprites.set(index, nameSprite)
      this.resolvedNames.set(index, displayName)

      const bubbleSprite = makeBubbleSprite('...')
      bubbleSprite.position.set(0, 3.35, 0)
      bubbleSprite.visible = false
      playerGroup.add(bubbleSprite)

      gameState.players.push({
        ...playerConfig,
        index,
        group: playerGroup,
        activeRole: 'villager',
        activeModel: basePlayerMesh,
        roleModels: {
          villager: basePlayerMesh
        },
        bubble: bubbleSprite,
        talkingUntil: 0,
        speechCooldown: Math.random() * 3
      })
    })
  }

  private createRoleMesh(role: Role, playerConfig: PlayerConfig): THREE.Object3D {
    switch (role) {
      case 'villager': return createPlayerMesh(playerConfig)
      case 'werewolf': return createWerewolfMesh()
      case 'doctor': return createDoctorMesh(playerConfig)
      case 'seer': return createSeerMesh()
      case 'angelDead': return createAngelMesh(playerConfig)
      default: return createPlayerMesh(playerConfig)
    }
  }

  private markModelAsPickable(model: THREE.Object3D, playerIndex: number): void {
    model.traverse((node) => {
      ;(node as THREE.Object3D & { userData: { playerIndex?: number } }).userData.playerIndex = playerIndex
    })
  }

  private getOrCreateRoleModel(player: Player, role: Role): THREE.Object3D {
    if (!player.roleModels[role]) {
      const model = this.createRoleMesh(role, player)
      model.visible = false
      this.markModelAsPickable(model, player.index)
      player.group.add(model)
      player.roleModels[role] = model
    }
    return player.roleModels[role]!
  }

  public setPlayerRole(player: Player, role: Role): void {
    this.ROLE_ORDER.forEach((roleName) => {
      const model = player.roleModels[roleName]
      if (model) {
        model.visible = false
      }
    })
    const nextModel = this.getOrCreateRoleModel(player, role)
    nextModel.visible = true
    player.activeRole = role
    player.activeModel = nextModel

    const roleLabel = this.ROLE_LABEL[role] ?? role
    this.chatManager.addMessageLine('System', `${player.name} marked as ${roleLabel}`)
  }

  private syncVisuals(): void {
    // Update name sprites for any slots that now have a nickname
    for (const [index, sprite] of this.nameSprites) {
      const nickname = gameState.playerNicknames.get(index)
      if (nickname && nickname !== this.resolvedNames.get(index)) {
        const oldMap = (sprite.material as THREE.SpriteMaterial).map
        const newSprite = makeTextSprite(nickname, { color: '#d9e0ff', scale: 1.4 })
        ;(sprite.material as THREE.SpriteMaterial).map = (newSprite.material as THREE.SpriteMaterial).map
        ;(sprite.material as THREE.SpriteMaterial).needsUpdate = true
        sprite.scale.copy(newSprite.scale)
        oldMap?.dispose()
        this.resolvedNames.set(index, nickname)
      }
    }

    // Don't process alive/dead status until the game has actually started;
    // pre-game views return all alive flags as false which would mark everyone dead.
    if (!gameState.gameStarted) return

    // aliveCount === 0 with finished=false means the ledger data is not yet
    // reliable (no alive flags set). Skip to avoid marking everyone as dead.
    if (gameState.aliveCount === 0 && !gameState.finished) return

    for (const player of gameState.players) {
      const alive = gameState.playerAlive[player.index]

      // Skip if alive status is not yet known from the backend
      if (alive === undefined) continue

      // Dead player → angel
      if (!alive && player.activeRole !== 'angelDead') {
        this.setPlayerRole(player, 'angelDead')
      }

      // On game end, reveal living werewolves
      if (gameState.finished && gameState.werewolfIndices.includes(player.index)) {
        if (alive && player.activeRole !== 'werewolf') {
          this.setPlayerRole(player, 'werewolf')
        }
        // Dead werewolves stay as angels
      }
    }
  }

  public destroy(): void {
    this.unsubscribe()
  }

  private findPlayerByNickname(nickname: string): Player | null {
    for (const [index, name] of gameState.playerNicknames) {
      if (name === nickname) {
        return gameState.players[index] ?? null
      }
    }
    return null
  }

  public showMessageForPlayer(nickname: string, text: string): void {
    const player = this.findPlayerByNickname(nickname)
    if (!player) {
      console.warn(`[PlayerEntities] No player found for nickname: ${nickname}`)
      return
    }

    const oldMap = (player.bubble.material as THREE.SpriteMaterial).map
    const bubbleUpdate = createBubbleTexture(text)
    ;(player.bubble.material as THREE.SpriteMaterial).map = bubbleUpdate.texture
    ;(player.bubble.material as THREE.SpriteMaterial).needsUpdate = true
    player.bubble.scale.copy(bubbleUpdate.scale)
    oldMap?.dispose()

    // Use clock elapsed time via the bubble talkingUntil; we need current time
    // from the animation loop. We store an absolute timestamp offset instead.
    player.talkingUntil = performance.now() / 1000 + 3
  }

  public updateSpeech(delta: number, clockTime: number): void {
    gameState.players.forEach((player, index) => {
      player.group.position.y = Math.sin(clockTime * 1.6 + index) * 0.03

      const now = performance.now() / 1000
      player.bubble.visible = player.talkingUntil > now
    })
  }
}
