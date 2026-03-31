/**
 * Werewolf Game Simulator & Test Suite
 * Compatible with the refactored Witness-based Contract
 *
 * Usage: npx tsx test/ww.test.ts
 */
import {
  WerewolfSimulator,
  RuntimeMerkleTree,
  encryptPayload,
  Role,
  Phase,
  logPass,
  logFail,
  computeRoundActionsDigest,
  computeVoteNullifier,
} from "./test-helpers.ts";

// ============================================
// MAIN TEST SUITE
// ============================================

async function runTestSuite() {
  const sim = new WerewolfSimulator();
  const { circuits } = sim.contract;

  console.log("\n\uD83E\uDDEA WEREWOLF CONTRACT TEST SUITE");

  // 1. SETUP KEYS & COMMITMENTS
  try {
    sim.adminKey = new Uint8Array(32);

    const r2 = await sim.runCircuit((ctx) =>
      circuits.testComputeHash(ctx, sim.masterSecret)
    );
    sim.masterSecretCommitment = r2 as unknown as Uint8Array;

    sim.adminSecretCommitment = await sim.runCircuit((ctx) =>
      circuits.testComputeAdminSecretCommitment(ctx, sim.adminSecret)
    ) as unknown as bigint;

    logPass("Keys & Secrets Generated");
  } catch (e) {
    logFail("Setup Keys", e);
    return;
  }

  // 2. GENERATE PLAYERS & BUILD MERKLE TREE
  const playerCount = 5;
  const werewolfCount = 1;
  const leaves: Uint8Array[] = [];

  for (let i = 0; i < playerCount; i++) {
    const p: any = { id: i, alive: true };
    // Generate Random Secret for Player
    p.sk = new Uint8Array(
      (await import("node:crypto")).createHash("sha256").update(`p${i}`).digest(),
    );
    p.encKeypair = (await import("tweetnacl")).default.box.keyPair();
    p.pk = p.encKeypair.publicKey;
    p.role = i < werewolfCount ? Role.Werewolf : Role.Villager;

    // Calc Salt
    const salt = await sim.runCircuit((ctx) =>
      circuits.testComputeSalt(ctx, sim.masterSecret, BigInt(i))
    );
    p.salt = salt;

    // Calc Commitment
    const comm = await sim.runCircuit((ctx) =>
      circuits.testComputeCommitment(ctx, BigInt(p.role), p.salt)
    );
    p.commitment = comm;

    // Calc Leaf Hash
    const leafHash = await sim.runCircuit((ctx) =>
      circuits.testComputeHash(ctx, p.sk)
    );
    p.leafHash = leafHash;

    leaves.push(leafHash);
    sim.players.push(p);
  }

  // Build Real Tree
  const tree = new RuntimeMerkleTree(sim, leaves);
  await tree.build();
  const root = tree.getRoot();

  // Generate Proofs for Players
  sim.players.forEach((p, i) => {
    p.merklePath = tree.getProof(i, p.leafHash);
  });

  // Verify Proofs Locally
  try {
    const valid = await sim.runCircuit((ctx) =>
      circuits.testVerifyMerkleProof(
        ctx,
        root,
        sim.players[0].leafHash,
        sim.players[0].merklePath!,
      )
    );
    if (valid) logPass("Merkle Tree Construction & Verification");
    else throw new Error("Verification returned false");
  } catch (e) {
    logFail("Merkle Verification", e);
    return;
  }

  // 3. CREATE GAME
  try {
    const roleCommitments = Array(32).fill(new Uint8Array(32));
    const encryptedRoles = Array(32).fill(new Uint8Array(3));
    sim.players.forEach((p) => roleCommitments[p.id] = p.commitment);
    sim.players.forEach((p) => {
      encryptedRoles[p.id] = encryptPayload(
        p.role,
        0,
        p.id % 1000,
        sim.adminEncKeypair.secretKey,
        p.encKeypair.publicKey,
        0,
      );
    });

    sim.updatePrivateState((state) => {
      state.setupData.set(String(sim.gameId), {
        roleCommitments,
        encryptedRoles,
        adminKey: { bytes: sim.adminKey },
        initialRoot: root,
      });
      state.adminSecrets = new Map([
        [String(sim.gameId), sim.adminSecret],
      ]);
    });

    await sim.runCircuit((ctx) =>
      circuits.createGame(
        ctx,
        sim.gameId,
        sim.adminVotePublicKeyBytes,
        sim.adminSecretCommitment,
        sim.masterSecretCommitment,
        BigInt(playerCount),
        BigInt(werewolfCount),
      )
    );
    logPass("createGame");
  } catch (e) {
    logFail("createGame", e);
    return;
  }

  // 4. NIGHT ACTION (Valid Vote)
  try {
    const actor = sim.players[0]; // Werewolf
    const targetIdx = 1;
    const actionRandom = 123;

    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: targetIdx,
        random: actionRandom,
        merklePath: actor.merklePath!,
        leafSecret: actor.sk,
      };
      state.encryptionKeypair = actor.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
    logPass("nightAction (Valid)");
  } catch (e) {
    logFail("nightAction (Valid)", e);
  }

  // 5. DOUBLE VOTING (Should Fail)
  try {
    const actor = sim.players[0];
    // Attempt same vote again
    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: 1,
        random: 123,
        merklePath: actor.merklePath!,
        leafSecret: actor.sk,
      };
      state.encryptionKeypair = actor.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
    logFail(
      "nightAction (Double Vote Check)",
      new Error("Should have thrown error"),
    );
  } catch (e: any) {
    if (String(e).includes("Action already submitted")) {
      logPass("nightAction (Prevented Double Vote)");
    } else {
      logFail("nightAction (Double Vote Check) - Wrong Error", e);
    }
  }

  // 6. ADMIN PUNISH PLAYER (Did not vote)
  try {
    const afkPlayer = sim.players[4];
    // Check alive before
    const aliveBefore = await sim.runCircuit((ctx) =>
      circuits.isPlayerAlive(ctx, sim.gameId, BigInt(afkPlayer.id))
    );
    if (!aliveBefore) throw new Error("Player 4 should be alive");

    // Punish
    await sim.runCircuit((ctx) =>
      circuits.adminPunishPlayer(ctx, sim.gameId, BigInt(afkPlayer.id))
    );

    // Check dead
    const aliveAfter = await sim.runCircuit((ctx) =>
      circuits.isPlayerAlive(ctx, sim.gameId, BigInt(afkPlayer.id))
    );
    if (!aliveAfter) logPass("adminPunishPlayer (Eliminated non-voter)");
    else throw new Error("Player 4 is still alive after punishment");
  } catch (e) {
    logFail("adminPunishPlayer", e);
  }

  // 7. RESOLVE NIGHT
  try {
    const nightEncryptedAction = encryptPayload(
      1,
      1,
      123,
      sim.players[0].encKeypair.secretKey,
      sim.adminVotePublicKeyBytes.slice(0, 32),
      1,
    );
    const nightDigest = computeRoundActionsDigest(sim.gameId, 1, Phase.Night, [
      {
        nullifier: computeVoteNullifier(
          sim.gameId,
          1,
          Phase.Night,
          sim.players[0].sk,
        ),
        encryptedAction: nightEncryptedAction,
      },
    ]);
    // Kill P1
    await sim.runCircuit((ctx) =>
      circuits.resolveNightPhase(
        ctx,
        sim.gameId,
        2n, // New Round
        1n, // Dead Player P1
        true, // Has Death
        root, // Keep same root for test simplicity
        nightDigest,
      )
    );
    sim.players[1].alive = false;
    logPass("resolveNightPhase");
  } catch (e) {
    logFail("resolveNightPhase", e);
  }

  // 8. DAY VOTE (Round 2)
  try {
    const voter = sim.players[0]; // Same player who voted night (P0)
    // Should be able to vote again because Round Changed -> Nullifier Changed

    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: 2, // Vote for P2
        random: 456,
        merklePath: voter.merklePath!,
        leafSecret: voter.sk,
      };
      state.encryptionKeypair = voter.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
    logPass("voteDay (Round 2 - Nullifier Unique)");
  } catch (e) {
    logFail("voteDay (Round 2)", e);
  }

  // 9. END GAME
  try {
    await sim.runCircuit((ctx) =>
      circuits.forceEndGame(ctx, sim.gameId, sim.masterSecret)
    );
    logPass("forceEndGame");
  } catch (e) {
    logFail("forceEndGame", e);
  }

  console.log("\n\u2705 Test Suite Finished");
}

runTestSuite().catch(console.error);
