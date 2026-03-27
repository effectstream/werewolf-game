/**
 * Vote submission service.
 *
 * Submits player votes directly to the Midnight contract via the player's own
 * Lace wallet identity (delegated through the batcher for proof generation).
 *
 * The on-chain circuit (nightAction / voteDay) validates:
 *   - Merkle proof: Hash(leafSecret) is in the current aliveTreeRoot
 *   - Nullifier: prevents double-voting within a round
 *   - Phase guard: circuit rejects if the contract is in the wrong phase
 *
 * After submission the STF (midnightContractState) detects the new vote
 * nullifier in Werewolf_voteNullifiers and updates the vote count. When all
 * eligible voters have voted the STF triggers resolvePhaseFromLedger().
 */

import type { PlayerBundle } from '../state/gameState'
import { submitVoteOnChain } from './playerVoteContract.ts'

export interface VoteSubmitResult {
  success: boolean
  /** Legacy field — with on-chain voting, double-voting is rejected by the nullifier circuit */
  alreadyVoted?: boolean
  error?: string
}

export async function submitVote(
  bundle: PlayerBundle,
  targetIndex: number,
  round: number,
  phase: string,
  gameId: number,
  callbacks?: { onProofDone?: () => void },
): Promise<VoteSubmitResult> {
  console.log('[voteService] submitting vote on-chain:', {
    gameId,
    round,
    phase,
    voterIndex: bundle.playerId,
    targetIndex,
  })

  try {
    await submitVoteOnChain(bundle, targetIndex, round, phase, gameId, callbacks)
    console.log('[voteService] on-chain vote submitted successfully')
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voteService] on-chain vote failed:', msg)
    return { success: false, error: msg }
  }
}
