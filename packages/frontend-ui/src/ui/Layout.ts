export function initLayout() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <div class="hud-top">
      <div class="phase-block">
        <div id="roundLabel">Round 1</div>
        <div id="phaseLabel">NIGHT</div>
      </div>
      <div class="role-block">
        <button id="maskedRoleBtn" class="ui-btn">You are a ******</button>
        <button id="revealRoleBtn" class="ui-btn">Reveal</button>
      </div>
    </div>
    <div class="layout">
      <aside class="sidebar">
        <h2>Players</h2>
        <div id="playersList" class="players-list"></div>
        <button id="endVoteBtn" class="ui-btn full">End Voting Phase</button>
      </aside>
      <div class="main-panel">
        <div id="sceneRoot" class="scene-root"></div>
        <section class="chat-panel">
          <div id="messagesBox" class="messages-box"></div>
          <form id="chatForm" class="chat-form">
            <input id="chatInput" class="chat-input" type="text" maxlength="120" placeholder="Type a message..." />
            <button class="ui-btn" type="submit">Send</button>
          </form>
        </section>
      </div>
    </div>
    <div id="rolePickerBackdrop" class="role-picker-backdrop hidden" aria-hidden="true">
      <div class="role-picker-modal" role="dialog" aria-modal="true" aria-labelledby="rolePickerTitle">
        <h3 id="rolePickerTitle">I think this player is a ...</h3>
        <div class="role-picker-actions">
          <button class="ui-btn full role-option-btn" data-role="villager">Villager</button>
          <button class="ui-btn full role-option-btn" data-role="werewolf">Werewolf</button>
          <button class="ui-btn full role-option-btn" data-role="doctor">Doctor</button>
          <button class="ui-btn full role-option-btn" data-role="seer">Seer</button>
          <button class="ui-btn full role-option-btn" data-role="angelDead">Angel (dead)</button>
        </div>
      </div>
    </div>
  `
}
