export type HairStyle = 'square' | 'round' | 'pointy' | 'ponytail'

export interface PlayerConfig {
  name: string
  cloth: number
  hair: number
  skin: number
  hairStyle: HairStyle
}