export interface PlayerConfig {
    name: string
    cloth: number
    hair: number
    skin: number

    // Hair / head style parameters (generated at game start and shared across models)
    hairWidth: number
    hairHeight: number
    hairDepth: number
    hasBun: boolean
    bunSize: number
  }