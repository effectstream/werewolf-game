import { werewolfIdCodec } from "../../../../../shared/utils/werewolf-id-codec.ts";

type Props = {
  gameId: number;
  className?: string;
};

export function GameIdDisplay({ gameId, className = "" }: Props) {
  const phrase = werewolfIdCodec.encode(gameId);
  return (
    <span className={`game-id ${className}`.trim()}>
      <span className="game-id-phrase">{phrase}</span>
      <span className="game-id-numeric">#{gameId}</span>
    </span>
  );
}
