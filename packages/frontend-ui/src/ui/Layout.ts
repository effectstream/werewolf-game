export function initLayout() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <div class="hud-top">
      <div class="phase-block">
        <div id="roundLabel">Round 1</div>
        <div class="phase-label-row">
          <div id="phaseLabel">NIGHT</div>
          <span id="phaseHelpIcon" class="phase-help-icon tooltip-icon has-tooltip" data-tooltip="">?</span>
        </div>
      </div>
      <div class="role-block">
        <div id="playerNicknameBadge" class="player-nickname-badge"></div>
        <div class="role-reveal-container">
          <span id="roleLabelDisplay" class="role-label-display"></span>
        </div>
      </div>
    </div>
    <div class="layout">
      <aside class="sidebar">
        <h2>Players</h2>
        <div id="playersList" class="players-list"></div>
        <div id="roundTimerBar" class="round-timer-bar hidden has-tooltip" data-tooltip="Players who do not vote before this timer expires will be automatically eliminated." title="Players who do not vote before this timer expires will be automatically eliminated.">
          <span id="roundTimerLabel" class="round-timer-label"></span>
        </div>
        <div id="voteStatusBar" class="vote-status-bar hidden">
          <span id="voteCountLabel">0/0 voted</span>
        </div>
        <button id="endVoteBtn" class="ui-btn full">End Voting Phase</button>
        <button id="returnToLobbyBtn" class="ui-btn full return-to-lobby-btn">← Lobby</button>
      </aside>
      <div class="main-panel">
        <div id="sceneRoot" class="scene-root">
          <div id="voteConfirmBackdrop" class="vote-confirm-backdrop hidden" aria-hidden="true">
            <div class="vote-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="voteConfirmTitle">
              <h3 id="voteConfirmTitle">Confirm Vote</h3>
              <p id="voteConfirmDesc">Are you sure you want to vote against <strong id="voteConfirmTargetName"></strong>?</p>
              <div class="vote-confirm-actions">
                <button id="voteConfirmYesBtn" class="ui-btn full danger">Confirm</button>
                <button id="voteConfirmNoBtn" class="ui-btn full">Cancel</button>
              </div>
              <div id="voteTxProgress" class="vote-tx-progress hidden">
                <div class="vote-tx-steps">
                  <div class="vote-tx-step" id="vtxStepProving">
                    <div class="vote-tx-dot"></div>
                    <div class="vote-tx-step-body">
                      <span class="vote-tx-step-label">Generating ZK Proof</span>
                      <span class="vote-tx-step-hint">~1–3 min</span>
                    </div>
                  </div>
                  <div class="vote-tx-connector"></div>
                  <div class="vote-tx-step" id="vtxStepBatcher">
                    <div class="vote-tx-dot"></div>
                    <div class="vote-tx-step-body">
                      <span class="vote-tx-step-label">Submitting to Batcher</span>
                      <span class="vote-tx-step-hint">~20–30 sec</span>
                    </div>
                  </div>
                  <div class="vote-tx-connector"></div>
                  <div class="vote-tx-step" id="vtxStepDone">
                    <div class="vote-tx-dot"></div>
                    <div class="vote-tx-step-body">
                      <span class="vote-tx-step-label">Done</span>
                    </div>
                  </div>
                </div>
                <div id="voteTxElapsed" class="vote-tx-elapsed"></div>
                <div id="voteTxFlavor" class="vote-tx-flavor"></div>
                <div id="voteTxReassurance" class="vote-tx-reassurance hidden">Still working — this is normal for ZK transactions.</div>
              </div>
            </div>
          </div>
        </div>
        <div class="chat-row">
          <section class="chat-panel">
            <div id="messagesBox" class="messages-box"></div>
            <form id="chatForm" class="chat-form">
              <input id="chatInput" class="chat-input" type="text" maxlength="120" placeholder="Type a message..." />
              <button class="ui-btn" type="submit">Send</button>
            </form>
          </section>
          <section class="chat-panel werewolf-chat-panel hidden" id="werewolfChatPanel">
            <div class="werewolf-chat-label">Werewolf Pack</div>
            <div id="werewolfMessagesBox" class="messages-box"></div>
            <form id="werewolfChatForm" class="chat-form">
              <input id="werewolfChatInput" class="chat-input" type="text" maxlength="120" placeholder="Whisper to your pack..." />
              <button class="ui-btn werewolf-send-btn" type="submit">Send</button>
            </form>
          </section>
        </div>
      </div>
    </div>
    <div id="rolePickerBackdrop" class="role-picker-backdrop hidden" aria-hidden="true">
      <div class="role-picker-modal" role="dialog" aria-modal="true" aria-labelledby="rolePickerTitle">
        <h3 id="rolePickerTitle">I think this player is a ...</h3>
        <div class="role-picker-actions">
          <button class="ui-btn full role-option-btn" data-role="villager">Villager</button>
          <button class="ui-btn full role-option-btn" data-role="werewolf">Werewolf</button>
        </div>
      </div>
    </div>
    <div id="announcementOverlay" class="announcement-overlay hidden" aria-live="assertive" role="status">
      <div id="announcementText" class="announcement-text"></div>
    </div>
    <div id="toastContainer" class="toast-container"></div>
    <div id="audioSettingsBackdrop" class="audio-settings-backdrop hidden" aria-hidden="true">
      <div class="audio-settings-modal" role="dialog" aria-modal="true" aria-labelledby="audioSettingsTitle">
        <h3 id="audioSettingsTitle" class="audio-settings-title">Audio Settings</h3>
        <div class="audio-settings-section">
          <div class="audio-settings-row">
            <span class="audio-settings-label">Music</span>
            <label class="audio-toggle-switch">
              <input type="checkbox" id="audioMusicToggle" />
              <span class="audio-toggle-track"></span>
            </label>
          </div>
          <div class="audio-track-list" id="audioTrackList"></div>
        </div>
        <div class="audio-settings-divider"></div>
        <div class="audio-settings-section">
          <div class="audio-settings-row">
            <span class="audio-settings-label">Sound Effects</span>
            <label class="audio-toggle-switch">
              <input type="checkbox" id="audioSfxToggle" />
              <span class="audio-toggle-track"></span>
            </label>
          </div>
        </div>
        <div class="audio-settings-actions">
          <button id="audioSettingsCloseBtn" class="ui-btn full">Close</button>
        </div>
      </div>
    </div>
    <button id="soundToggleBtn" class="sound-toggle-btn" aria-label="Audio settings">
      <span class="sound-icon"></span>
    </button>
  `
}
