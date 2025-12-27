const HOST_REJOIN_KEY = "trivia_host_rejoin";
const TEAM_REJOIN_KEY = "trivia_team_rejoin";

export interface HostRejoinData {
  gameCode: string;
}

export interface TeamRejoinData {
  gameCode: string;
  teamName: string;
  teamMembers: string[];
  colorHex: string;
  colorName: string;
}

export function saveHostRejoin(data: HostRejoinData): void {
  try {
    localStorage.setItem(HOST_REJOIN_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save host rejoin data:", e);
  }
}

export function getHostRejoin(): HostRejoinData | null {
  try {
    const data = localStorage.getItem(HOST_REJOIN_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (typeof parsed.gameCode === "string") {
      return parsed as HostRejoinData;
    }
    return null;
  } catch (e) {
    console.error("Failed to get host rejoin data:", e);
    clearHostRejoin();
    return null;
  }
}

export function clearHostRejoin(): void {
  try {
    localStorage.removeItem(HOST_REJOIN_KEY);
  } catch (e) {
    console.error("Failed to clear host rejoin data:", e);
  }
}

export function saveTeamRejoin(data: TeamRejoinData): void {
  try {
    localStorage.setItem(TEAM_REJOIN_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save team rejoin data:", e);
  }
}

export function getTeamRejoin(): TeamRejoinData | null {
  try {
    const data = localStorage.getItem(TEAM_REJOIN_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (
      typeof parsed.gameCode === "string" &&
      typeof parsed.teamName === "string" &&
      Array.isArray(parsed.teamMembers) &&
      typeof parsed.colorHex === "string" &&
      typeof parsed.colorName === "string"
    ) {
      return parsed as TeamRejoinData;
    }
    return null;
  } catch (e) {
    console.error("Failed to get team rejoin data:", e);
    clearTeamRejoin();
    return null;
  }
}

export function clearTeamRejoin(): void {
  try {
    localStorage.removeItem(TEAM_REJOIN_KEY);
  } catch (e) {
    console.error("Failed to clear team rejoin data:", e);
  }
}
