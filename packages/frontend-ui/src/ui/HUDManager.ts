import { gameState } from "../state/gameState";

const ROLE_LABELS: Record<number, string> = {
  0: "Villager",
  1: "Werewolf",
};

export class HUDManager {
  private roundLabel: HTMLDivElement;
  private phaseLabel: HTMLDivElement;
  private phaseHelpIcon: HTMLSpanElement;
  private roleLabelDisplay: HTMLSpanElement;
  private endVoteBtn: HTMLButtonElement;
  private nicknameBadge: HTMLDivElement;
  private roundTimerBar: HTMLDivElement;
  private roundTimerLabel: HTMLSpanElement;

  private unsubscribe: () => void;
  /** Tracks previous vote count to detect increments for the bump animation */
  private lastVoteCount: number = 0;

  constructor() {
    this.roundLabel = document.querySelector<HTMLDivElement>("#roundLabel")!;
    this.phaseLabel = document.querySelector<HTMLDivElement>("#phaseLabel")!;
    this.phaseHelpIcon = document.querySelector<HTMLSpanElement>("#phaseHelpIcon")!;
    this.roleLabelDisplay = document.querySelector<HTMLSpanElement>(
      "#roleLabelDisplay",
    )!;
    this.endVoteBtn = document.querySelector<HTMLButtonElement>("#endVoteBtn")!;
    this.nicknameBadge = document.querySelector<HTMLDivElement>(
      "#playerNicknameBadge",
    )!;
    this.roundTimerBar = document.querySelector<HTMLDivElement>("#roundTimerBar")!;
    this.roundTimerLabel = document.querySelector<HTMLSpanElement>("#roundTimerLabel")!;

    this.initEventListeners();

    this.unsubscribe = gameState.subscribe(() => this.updatePhaseHud());

    // Initial update
    this.updatePhaseHud();
  }

  private initEventListeners() {
    // End vote button is now display-only; phase is driven by polled backend state
    this.endVoteBtn.style.display = "none";
  }

  private updateNicknameBadge() {
    const nickname =
      gameState.playerNickname ??
      gameState.playerNicknames.get(gameState.playerBundle?.playerId ?? -1) ??
      null;
    this.nicknameBadge.textContent = nickname ? `Playing as ${nickname}` : "";
  }

  private updatePhaseHud() {
    this.updateNicknameBadge();
    this.updateRoleDisplay();
    this.roundLabel.textContent = `Round ${gameState.round}`;

    if (gameState.finished) {
      this.phaseLabel.textContent = "GAME OVER";
      this.phaseLabel.classList.remove("day");
      this.phaseHelpIcon.hidden = true;
    } else {
      this.phaseLabel.textContent = gameState.phase;
      this.phaseLabel.classList.toggle("day", gameState.phase === "DAY");
      this.phaseHelpIcon.hidden = false;
      this.phaseHelpIcon.dataset.tooltip = gameState.phase === "DAY"
        ? "DAY — All players vote to eliminate a suspect. The player with the most votes is eliminated."
        : "NIGHT — Werewolves secretly vote to eliminate a villager.";
    }

    const voteBar = document.querySelector<HTMLDivElement>("#voteStatusBar");
    const voteLabel = document.querySelector<HTMLSpanElement>(
      "#voteCountLabel",
    );
    if (voteBar && voteLabel) {
      const showBar =
        (gameState.phase === "DAY" || gameState.phase === "NIGHT") &&
        gameState.gameStarted &&
        !gameState.finished &&
        gameState.aliveCount > 0;
      voteBar.classList.toggle("hidden", !showBar);
      if (showBar) {
        if (gameState.allVotesIn) {
          // All votes collected — show pulsing waiting state
          if (!voteLabel.classList.contains("waiting-label")) {
            voteLabel.classList.add("waiting-label");
            voteLabel.textContent = "⏳ Waiting for results…";
          }
        } else {
          voteLabel.classList.remove("waiting-label");
          const prevCount = this.lastVoteCount;
          const newCount = gameState.voteCount;
          if (newCount !== prevCount) {
            // Trigger bump animation when count increases
            voteLabel.classList.remove("vote-count-bump");
            void voteLabel.offsetWidth; // force reflow to restart animation
            voteLabel.classList.add("vote-count-bump");
            setTimeout(() => voteLabel.classList.remove("vote-count-bump"), 400);
          }
          this.lastVoteCount = newCount;
          voteLabel.textContent =
            `${gameState.voteCount}/${gameState.aliveCount} voted`;
        }
      }
    }

    this.updateRoundTimer();
  }

  private formatRemainingTime(seconds: number): string {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m < 60) return `${m}:${s.toString().padStart(2, "0")}`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  private updateRoundTimer(): void {
    const {
      phase,
      finished,
      allVotesIn,
      gameStarted,
      roundTimeoutBlock,
      roundCurrentBlock,
    } = gameState;

    const shouldShow =
      !finished &&
      !allVotesIn &&
      (phase === "DAY" || phase === "NIGHT") &&
      gameStarted &&
      roundTimeoutBlock !== null &&
      roundCurrentBlock !== null;

    this.roundTimerBar.classList.toggle("hidden", !shouldShow);

    if (shouldShow) {
      const remaining = Math.max(0, roundTimeoutBlock! - roundCurrentBlock!);
      this.roundTimerLabel.textContent =
        `Punishment timer: ${this.formatRemainingTime(remaining)}`;
    }
  }

  private updateRoleDisplay() {
    const playerId = gameState.playerBundle?.playerId;
    const isDead = playerId !== undefined &&
      gameState.playerAlive[playerId] === false;

    if (isDead) {
      this.roleLabelDisplay.textContent = "You are dead";
      this.roleLabelDisplay.classList.add("dead");
      return;
    }

    const roleNum = gameState.playerBundle?.role;
    const roleLabel = roleNum !== undefined
      ? (ROLE_LABELS[roleNum] ?? "Villager")
      : "Villager";
    this.roleLabelDisplay.textContent = `You are a ${roleLabel}`;
    this.roleLabelDisplay.classList.remove("dead");
  }

  public destroy(): void {
    this.unsubscribe();
  }
}
