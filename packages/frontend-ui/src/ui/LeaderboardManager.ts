const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

interface LeaderboardEntry {
  evm_address: string;
  total_points: string;
  games_played: number;
  games_won: number;
  rounds_survived: number;
}

export class LeaderboardManager {
  private panel: HTMLDivElement;
  private tableBody: HTMLTableSectionElement;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.panel = this.createPanel();
    document.body.appendChild(this.panel);
    this.tableBody = this.panel.querySelector<HTMLTableSectionElement>(
      "#leaderboard-tbody",
    )!;

    this.panel.querySelector<HTMLButtonElement>("#leaderboard-close")!
      .addEventListener("click", () => this.hide());

    this.panel.querySelector<HTMLButtonElement>("#leaderboard-toggle")!
      .addEventListener("click", () => this.toggle());
  }

  private createPanel(): HTMLDivElement {
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "leaderboard-toggle";
    toggleBtn.className = "ui-btn leaderboard-toggle-btn";
    toggleBtn.textContent = "🏆 Leaderboard";
    toggleBtn.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:1000;padding:8px 14px;font-size:13px;";
    document.body.appendChild(toggleBtn);

    const panel = document.createElement("div");
    panel.id = "leaderboard-panel";
    panel.className = "leaderboard-panel hidden";
    panel.innerHTML = `
      <div class="leaderboard-header">
        <span>🏆 Leaderboard</span>
        <button id="leaderboard-close" class="leaderboard-close-btn">✕</button>
      </div>
      <div class="leaderboard-scroll">
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>EVM Address</th>
              <th>Points</th>
              <th>W/P</th>
              <th>Rounds</th>
            </tr>
          </thead>
          <tbody id="leaderboard-tbody">
            <tr><td colspan="5" class="leaderboard-loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    `;
    return panel;
  }

  show() {
    this.panel.classList.remove("hidden");
    this.fetchAndRender();
    this.refreshInterval = setInterval(() => this.fetchAndRender(), 10_000);
  }

  hide() {
    this.panel.classList.add("hidden");
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  toggle() {
    if (this.panel.classList.contains("hidden")) {
      this.show();
    } else {
      this.hide();
    }
  }

  private async fetchAndRender() {
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard?limit=50&offset=0`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { entries: LeaderboardEntry[] } = await res.json();
      this.render(data.entries);
    } catch (err) {
      this.tableBody.innerHTML =
        `<tr><td colspan="5" class="leaderboard-error">Failed to load leaderboard.</td></tr>`;
      console.warn("[leaderboard] fetch failed:", err);
    }
  }

  private render(entries: LeaderboardEntry[]) {
    if (entries.length === 0) {
      this.tableBody.innerHTML =
        `<tr><td colspan="5" class="leaderboard-empty">No entries yet.</td></tr>`;
      return;
    }

    this.tableBody.innerHTML = entries
      .map((e, i) => {
        const addr = e.evm_address;
        const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
        const pts = Number(e.total_points).toLocaleString();
        return `<tr>
          <td class="lb-rank">${i + 1}</td>
          <td class="lb-addr" title="${addr}">${short}</td>
          <td class="lb-pts">${pts}</td>
          <td class="lb-wins">${e.games_won}/${e.games_played}</td>
          <td class="lb-rounds">${e.rounds_survived}</td>
        </tr>`;
      })
      .join("");
  }
}
