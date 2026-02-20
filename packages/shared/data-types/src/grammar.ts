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
      }),
    ],
  ],
} as const satisfies GrammarDefinition;
