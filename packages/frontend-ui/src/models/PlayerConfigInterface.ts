export type HairStyle =
  | 'square'
  | 'round'
  | 'pointy'
  | 'ponytail'
  | 'baseballCap'
  | 'topHat'
  | 'mohawk'
  | 'jrpg'

export interface PlayerConfig {
  name: string
  cloth: number
  hair: number
  skin: number
  hairStyle: HairStyle
}