/**
 * Werewolf Contract — Security Test Suite
 *
 * Tests adversarial scenarios: impersonation, double-voting, replay attacks,
 * phase violations, dead-player voting, admin authorization, game state
 * integrity, and edge cases.
 *
 * Usage: deno -A test/ww.security.test.ts
 */
import { createHash } from "node:crypto";
import {
  advanceToDay,
  computeRoundActionsDigest,
  logFail,
  logPass,
  Phase,
  setupGameReady,
} from "./test-helpers.ts";

// ============================================
// ASSERTION HELPERS
// ============================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function expectFail(
  name: string,
  expectedMsg: string,
  fn: () => Promise<void>,
) {
  totalTests++;
  try {
    await fn();
    logFail(name, new Error("Should have thrown but succeeded"));
    failedTests++;
  } catch (e: any) {
    if (String(e).includes(expectedMsg)) {
      logPass(name);
      passedTests++;
    } else {
      logFail(name, new Error(`Expected "${expectedMsg}" but got: ${e}`));
      failedTests++;
    }
  }
}

async function expectPass(name: string, fn: () => Promise<void>) {
  totalTests++;
  try {
    await fn();
    logPass(name);
    passedTests++;
  } catch (e) {
    logFail(name, e);
    failedTests++;
  }
}

// ============================================
// MAIN SECURITY TEST SUITE
// ============================================

async function runSecurityTests() {
  console.log("\n\uD83D\uDD12 WEREWOLF CONTRACT SECURITY TEST SUITE\n");

  // ========================================
  // GROUP 1: IMPERSONATION TESTS
  // ========================================
  console.log("--- GROUP 1: Impersonation ---");

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 1a. Player Y uses Player X's leafSecret + Y's encKeypair
    // SECURITY FINDING: Circuit only checks Merkle proof (leafSecret -> leaf in tree).
    // If leafSecret is compromised, attacker can impersonate. This is by design for ZK voting.
    await expectPass(
      "1a. Stolen leafSecret allows impersonation (documents design tradeoff)",
      async () => {
        const victimP0 = sim.players[0];
        const attackerP1 = sim.players[1];

        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 2,
            random: 100,
            merklePath: victimP0.merklePath!,
            leafSecret: victimP0.sk, // stolen from P0
          };
          state.encryptionKeypair = attackerP1.encKeypair; // attacker's own keys
        });

        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );

    // 1b. Fabricated leafSecret not in tree
    await expectFail(
      "1b. Fabricated leafSecret rejected (not in Merkle tree)",
      "Invalid Merkle Proof or Player Dead",
      async () => {
        const fakeSk = new Uint8Array(
          createHash("sha256").update("fake-player").digest(),
        );

        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 200,
            merklePath: sim.players[1].merklePath!, // use any path
            leafSecret: fakeSk, // hash won't match any leaf
          };
          state.encryptionKeypair = sim.players[1].encKeypair;
        });

        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 1c. Correct leafSecret but wrong Merkle path
    await expectFail(
      "1c. Valid leafSecret + wrong Merkle path rejected",
      "Invalid Merkle Proof or Player Dead",
      async () => {
        const player1 = sim.players[1];
        const player2 = sim.players[2];

        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 3,
            random: 300,
            merklePath: player2.merklePath!, // P2's path (leaf mismatch)
            leafSecret: player1.sk, // P1's secret
          };
          state.encryptionKeypair = player1.encKeypair;
        });

        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );

    // 1d. Correct leafSecret, path with one flipped sibling
    await expectFail(
      "1d. Tampered Merkle path sibling rejected",
      "Invalid Merkle Proof or Player Dead",
      async () => {
        const player1 = sim.players[1];
        const originalPath = player1.merklePath!;

        // Deep clone and tamper one sibling
        const tamperedPath = {
          leaf: originalPath.leaf,
          path: originalPath.path.map((entry, i) => {
            if (i === 0) {
              return {
                sibling: { field: entry.sibling.field + 1n }, // flip one bit
                goes_left: entry.goes_left,
              };
            }
            return entry;
          }),
        };

        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 3,
            random: 400,
            merklePath: tamperedPath,
            leafSecret: player1.sk,
          };
          state.encryptionKeypair = player1.encKeypair;
        });

        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  // ========================================
  // GROUP 2: DOUBLE VOTING TESTS
  // ========================================
  console.log("\n--- GROUP 2: Double Voting ---");

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 2a. Same player votes twice in Night
    await expectPass("2a-setup. P0 votes night (first vote)", async () => {
      sim.updatePrivateState((state) => {
        state.nextAction = {
          targetNumber: 1,
          random: 100,
          merklePath: sim.players[0].merklePath!,
          leafSecret: sim.players[0].sk,
        };
        state.encryptionKeypair = sim.players[0].encKeypair;
      });
      await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
    });

    await expectFail(
      "2a. Double vote in Night rejected",
      "Action already submitted",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 2,
            random: 200,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim, tree, root } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // Advance to Day for 2b test
    await advanceToDay(sim, tree, root, 0, 1, false);

    // 2b. Same player votes twice in Day
    await expectPass("2b-setup. P0 votes day (first vote)", async () => {
      sim.updatePrivateState((state) => {
        state.nextAction = {
          targetNumber: 2,
          random: 100,
          merklePath: sim.players[0].merklePath!,
          leafSecret: sim.players[0].sk,
        };
        state.encryptionKeypair = sim.players[0].encKeypair;
      });
      await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
    });

    await expectFail(
      "2b. Double vote in Day rejected",
      "Double voting detected",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 3,
            random: 200,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim, tree, root } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 2c. Cross-phase voting (Night then Day) is allowed
    await expectPass(
      "2c. Cross-phase voting allowed (Night + Day, same round)",
      async () => {
        // P0 votes Night
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));

        // Resolve to Day
        await advanceToDay(sim, tree, root, 2, 3, false);

        // P0 votes Day (different nullifier domain)
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 2,
            random: 200,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
      },
    );
  }

  {
    // 2d. Nullifier uniqueness properties
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    await expectPass(
      "2d. Nullifier uniqueness: Night vs Day, different rounds, different gameIds, different players",
      async () => {
        const sk = sim.players[0].sk;
        const sk2 = sim.players[1].sk;
        const gid = sim.gameId;

        // Night vs Day (same gameId, round, leafSecret)
        const nullNight = await sim.runCircuit((ctx) =>
          circuits.testComputeNullifierNight(ctx, gid, 1n, sk)
        );
        const nullDay = await sim.runCircuit((ctx) =>
          circuits.testComputeNullifierDay(ctx, gid, 1n, sk)
        );
        if (arraysEqual(nullNight, nullDay)) {
          throw new Error("Night and Day nullifiers should differ");
        }

        // Same phase, different round
        const nullNightR2 = await sim.runCircuit((ctx) =>
          circuits.testComputeNullifierNight(ctx, gid, 2n, sk)
        );
        if (arraysEqual(nullNight, nullNightR2)) {
          throw new Error(
            "Different rounds should produce different nullifiers",
          );
        }

        // Same phase+round, different gameId
        const nullNightG2 = await sim.runCircuit((ctx) =>
          circuits.testComputeNullifierNight(ctx, gid + 1n, 1n, sk)
        );
        if (arraysEqual(nullNight, nullNightG2)) {
          throw new Error(
            "Different gameIds should produce different nullifiers",
          );
        }

        // Same phase+round+gameId, different leafSecret
        const nullNightP2 = await sim.runCircuit((ctx) =>
          circuits.testComputeNullifierNight(ctx, gid, 1n, sk2)
        );
        if (arraysEqual(nullNight, nullNightP2)) {
          throw new Error(
            "Different players should produce different nullifiers",
          );
        }
      },
    );
  }

  // ========================================
  // GROUP 3: REPLAY ATTACK TESTS
  // ========================================
  console.log("\n--- GROUP 3: Replay Attacks ---");

  {
    const { sim, tree, root } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 3a. Resubmit vote data from round 1 in round 2
    // The circuit reads state.round from ledger internally, so the nullifier
    // will be computed with round=2 even if witness data is identical.
    await expectPass(
      "3a. Same witness data in round 2 produces new nullifier (replay safe)",
      async () => {
        const voter = sim.players[0];

        // Vote in round 1
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: voter.merklePath!,
            leafSecret: voter.sk,
          };
          state.encryptionKeypair = voter.encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));

        // Advance to Day, then resolve Day to get to round 2 Night
        const { newTree, newRoot } = await advanceToDay(
          sim,
          tree,
          root,
          2,
          3,
          false,
        );

        // Resolve day phase to advance to round 2 Night
        const dayDigest = computeRoundActionsDigest(
          sim.gameId,
          2,
          Phase.Day,
          [],
        );
        await sim.runCircuit((ctx) =>
          circuits.resolveDayPhase(
            ctx,
            sim.gameId,
            0n,
            false,
            dayDigest,
          )
        );

        // Now in round 2 Night — same witness data should work (new nullifier)
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: voter.merklePath!,
            leafSecret: voter.sk,
          };
          state.encryptionKeypair = voter.encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    // 3b. Cross-game replay: same player votes in two different games
    await expectPass(
      "3b. Cross-game vote uses different nullifier (no collision)",
      async () => {
        const { sim: simA } = await setupGameReady(5, 1);
        const { sim: simB } = await setupGameReady(5, 1);

        // Vote in game A
        simA.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: simA.players[0].merklePath!,
            leafSecret: simA.players[0].sk,
          };
          state.encryptionKeypair = simA.players[0].encKeypair;
        });
        await simA.runCircuit((ctx) =>
          simA.contract.circuits.nightAction(ctx, simA.gameId)
        );

        // Vote in game B (independent state, different gameId -> different nullifier)
        simB.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: simB.players[0].merklePath!,
            leafSecret: simB.players[0].sk,
          };
          state.encryptionKeypair = simB.players[0].encKeypair;
        });
        await simB.runCircuit((ctx) =>
          simB.contract.circuits.nightAction(ctx, simB.gameId)
        );
      },
    );
  }

  // ========================================
  // GROUP 4: PHASE VIOLATION TESTS
  // ========================================
  console.log("\n--- GROUP 4: Phase Violations ---");

  {
    const { sim, tree, root } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 4b. voteDay during Night phase (game starts in Night)
    await expectFail(
      "4b. voteDay during Night rejected",
      "Not Day phase",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
      },
    );

    // Advance to Day for 4a test
    await advanceToDay(sim, tree, root, 0, 1, false);

    // 4a. nightAction during Day phase
    await expectFail(
      "4a. nightAction during Day rejected",
      "Not Night phase",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 2,
            random: 200,
            merklePath: sim.players[1].merklePath!,
            leafSecret: sim.players[1].sk,
          };
          state.encryptionKeypair = sim.players[1].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // Force end the game
    await sim.runCircuit((ctx) =>
      circuits.forceEndGame(ctx, sim.gameId, sim.masterSecret)
    );

    // 4c. nightAction during Finished
    await expectFail(
      "4c. nightAction during Finished rejected",
      "Not Night phase",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );

    // 4d. voteDay during Finished
    await expectFail(
      "4d. voteDay during Finished rejected",
      "Not Day phase",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
      },
    );
  }

  // ========================================
  // GROUP 5: DEAD PLAYER VOTING TESTS
  // ========================================
  console.log("\n--- GROUP 5: Dead Player Voting ---");

  {
    const { sim, tree, root } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // Kill P1 during night resolution and advance to Day
    const { newTree, newRoot } = await advanceToDay(
      sim,
      tree,
      root,
      0,
      1,
      true,
    );

    // 5a. Eliminated player tries to vote with old Merkle proof
    await expectFail(
      "5a. Dead player vote rejected (old Merkle proof vs new root)",
      "Invalid Merkle Proof",
      async () => {
        const deadPlayer = sim.players[1];
        // Use the old proof (before tree was updated)
        const oldPath = tree.getProof(1, deadPlayer.leafHash);

        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 2,
            random: 100,
            merklePath: oldPath,
            leafSecret: deadPlayer.sk,
          };
          state.encryptionKeypair = deadPlayer.encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 5b. Punished player can still vote (adminPunishPlayer doesn't update tree root)
    // SECURITY FINDING: adminPunishPlayer sets isAlive=false in players map
    // but does NOT update aliveTreeRoot. Punished player's Merkle proof still valid.
    await expectPass(
      "5b. Punished player can still vote (tree root not updated — known limitation)",
      async () => {
        // Punish P4
        await sim.runCircuit((ctx) =>
          circuits.adminPunishPlayer(ctx, sim.gameId, BigInt(4))
        );

        // P4 tries to vote — should succeed because tree root unchanged
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[4].merklePath!,
            leafSecret: sim.players[4].sk,
          };
          state.encryptionKeypair = sim.players[4].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  // ========================================
  // GROUP 6: ADMIN AUTHORIZATION TESTS
  // ========================================
  console.log("\n--- GROUP 6: Admin Authorization ---");

  // Admin authorization uses a ZK secret commitment. The game creator proves
  // knowledge of adminSecret via witness — the hash is compared to the stored
  // adminSecretCommitment (Field) on-chain. This can be tested locally by
  // swapping the adminSecret in private state.

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 6a. Verify admin secret commitment is set correctly on game creation
    await expectPass(
      "6a. Game stores adminSecretCommitment from creator",
      async () => {
        const gameState = await sim.runCircuit((ctx) =>
          circuits.getGameState(ctx, sim.gameId)
        );
        if (!gameState || !gameState.adminSecretCommitment) {
          throw new Error("Game state missing adminSecretCommitment");
        }
      },
    );

    // 6b. Verify forceEndGame requires correct master secret (admin-adjacent check)
    await expectFail(
      "6b. forceEndGame with wrong master secret (admin secret check)",
      "Invalid Master Secret for this Game",
      async () => {
        const wrongSecret = new Uint8Array(32);
        wrongSecret[0] = 0xFF;
        await sim.runCircuit((ctx) =>
          circuits.forceEndGame(ctx, sim.gameId, wrongSecret)
        );
      },
    );

    // 6c. Admin can successfully call admin-only circuits (positive test)
    await expectPass(
      "6c. Admin can call adminPunishPlayer (positive authorization)",
      async () => {
        await sim.runCircuit((ctx) =>
          circuits.adminPunishPlayer(ctx, sim.gameId, 4n)
        );
      },
    );

    // 6d. Admin can successfully call forceEndGame
    await expectPass(
      "6d. Admin can call forceEndGame (positive authorization)",
      async () => {
        await sim.runCircuit((ctx) =>
          circuits.forceEndGame(ctx, sim.gameId, sim.masterSecret)
        );
      },
    );

    // 6e. Non-admin caller (wrong adminSecret) should fail
    await expectFail(
      "6e. Non-admin caller with wrong adminSecret rejected",
      "Only Admin",
      async () => {
        // Temporarily swap adminSecret to a wrong value
        sim.updatePrivateState((state) => {
          const wrongSecret = new Uint8Array(32);
          wrongSecret[0] = 0xFF;
          state.adminSecrets = new Map([
            [String(sim.gameId), wrongSecret],
          ]);
        });
        await sim.runCircuit((ctx) =>
          circuits.adminPunishPlayer(ctx, sim.gameId, 3n)
        );
      },
    );

    // Restore correct adminSecret for subsequent tests
    sim.updatePrivateState((state) => {
      state.adminSecrets = new Map([
        [String(sim.gameId), sim.adminSecret],
      ]);
    });
  }

  // ========================================
  // GROUP 7: GAME STATE INTEGRITY TESTS
  // ========================================
  console.log("\n--- GROUP 7: Game State Integrity ---");

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 7a. Vote for nonexistent game
    await expectFail(
      "7a. Vote for nonexistent game rejected",
      "", // Map lookup error — message varies by runtime
      async () => {
        const fakeGameId = sim.gameId + 9999n;
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 1,
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, fakeGameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 7b. forceEndGame with wrong master secret
    await expectFail(
      "7b. forceEndGame with wrong master secret rejected",
      "Invalid Master Secret for this Game",
      async () => {
        const wrongSecret = new Uint8Array(
          createHash("sha256").update("wrong-secret").digest(),
        );
        await sim.runCircuit((ctx) =>
          circuits.forceEndGame(ctx, sim.gameId, wrongSecret)
        );
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 7c. Duplicate gameId
    await expectFail(
      "7c. Duplicate gameId rejected",
      "Game ID already exists",
      async () => {
        await sim.runCircuit((ctx) =>
          circuits.createGame(
            ctx,
            sim.gameId, // same ID
            sim.adminVotePublicKeyBytes,
            sim.adminSecretCommitment,
            sim.masterSecretCommitment,
            5n,
            1n,
          )
        );
      },
    );
  }

  // ========================================
  // GROUP 8: EDGE CASES
  // ========================================
  console.log("\n--- GROUP 8: Edge Cases ---");

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 8a. Vote for self (contract doesn't validate target — opaque encrypted bytes)
    await expectPass(
      "8a. Self-vote accepted (target is opaque on-chain)",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 0, // P0 votes for self
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 8b. Vote for non-existent player index (target validation is off-chain)
    await expectPass(
      "8b. Vote for non-existent player index accepted (opaque payload)",
      async () => {
        sim.updatePrivateState((state) => {
          state.nextAction = {
            targetNumber: 99, // no player 99
            random: 100,
            merklePath: sim.players[0].merklePath!,
            leafSecret: sim.players[0].sk,
          };
          state.encryptionKeypair = sim.players[0].encKeypair;
        });
        await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
      },
    );
  }

  {
    const { sim } = await setupGameReady(5, 1);
    const { circuits } = sim.contract;

    // 8c. All alive players vote for same target
    await expectPass(
      "8c. All players vote for same target (unique nullifiers per player)",
      async () => {
        for (const p of sim.players) {
          sim.updatePrivateState((state) => {
            state.nextAction = {
              targetNumber: 1, // all vote for P1
              random: 100 + p.id,
              merklePath: p.merklePath!,
              leafSecret: p.sk,
            };
            state.encryptionKeypair = p.encKeypair;
          });
          await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
        }
      },
    );
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log("\n========================================");
  console.log(
    `\uD83D\uDD12 SECURITY TEST RESULTS: ${passedTests}/${totalTests} passed, ${failedTests} failed`,
  );
  if (failedTests > 0) {
    console.log("\u274C Some security tests FAILED!");
    Deno.exit(1);
  } else {
    console.log("\u2705 All security tests PASSED!");
  }

  console.log("\n\uD83D\uDCCB SECURITY FINDINGS DOCUMENTED:");
  console.log(
    "  1. leafSecret is sole identity credential — compromise = full impersonation (test 1a)",
  );
  console.log(
    "  2. adminPunishPlayer does NOT update Merkle root — punished players can vote (test 5b)",
  );
  console.log(
    "  3. Encrypted vote payload is opaque on-chain — no target/round validation (tests 8a, 8b)",
  );
}

// ============================================
// UTILITY
// ============================================

function arraysEqual(
  a: Uint8Array | unknown,
  b: Uint8Array | unknown,
): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================
// RUN
// ============================================

runSecurityTests().catch((e) => {
  console.error("Security test suite crashed:", e);
  Deno.exit(1);
});
