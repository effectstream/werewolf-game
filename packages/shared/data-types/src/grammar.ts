import type { GrammarDefinition } from "@paimaexample/concise";
import { builtinGrammars } from "@paimaexample/sm/grammar";
import { Type } from "@sinclair/typebox";

export const grammar = {
  "transfer-assets": builtinGrammars.evmErc721,
  "midnightContractState": [
    [
      "payload",
      Type.Object({
        // Define each ledger field from your Compact contract
        // The syncer will now know these are objects and will correctly unroll them
        Werewolf_games: Type.Any(),
        Werewolf_playerAlive: Type.Any(),
        Werewolf_playerRoleCommitments: Type.Any(),
        Werewolf_playerEncryptedRoles: Type.Any(),
        Werewolf_voteNullifiers: Type.Any(),
        Werewolf_gameSecrets: Type.Any(),
        Werewolf_roundEncryptedVotes: Type.Any(),
        Werewolf_movesSubmittedCount: Type.Any(),
      }),
    ],
  ],
  // Scheduled input: fires at a future block when a voting round times out.
  // Produced by createScheduledData() in the midnightContractState STF.
  "werewolfRoundTimeout": [
    ["gameId", Type.Number()],
    ["round", Type.Number()],
    ["phase", Type.String()],
  ],
} as const satisfies GrammarDefinition;
