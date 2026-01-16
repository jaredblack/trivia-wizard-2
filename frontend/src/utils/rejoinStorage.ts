const HOST_REJOIN_KEY = "trivia_host_rejoin";
const TEAM_REJOIN_KEY = "trivia_team_rejoin";
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HostRejoinData {
  gameCode: string;
  savedAt: number;
}

export interface TeamRejoinData {
  gameCode: string;
  teamName: string;
  savedAt: number;
}

export function saveHostRejoin(data: Omit<HostRejoinData, "savedAt">): void {
  try {
    const dataWithTimestamp: HostRejoinData = { ...data, savedAt: Date.now() };
    localStorage.setItem(HOST_REJOIN_KEY, JSON.stringify(dataWithTimestamp));
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
      // Check expiration
      if (parsed.savedAt && Date.now() - parsed.savedAt > EXPIRATION_MS) {
        clearHostRejoin();
        return null;
      }
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

export function saveTeamRejoin(data: Omit<TeamRejoinData, "savedAt">): void {
  try {
    // Don't save if gameCode or teamName are empty
    if (!data.gameCode || !data.teamName) {
      console.warn("Attempted to save team rejoin data with empty gameCode or teamName");
      return;
    }
    const dataWithTimestamp: TeamRejoinData = { ...data, savedAt: Date.now() };
    localStorage.setItem(TEAM_REJOIN_KEY, JSON.stringify(dataWithTimestamp));
  } catch (e) {
    console.error("Failed to save team rejoin data:", e);
  }
}

export function getTeamRejoin(): TeamRejoinData | null {
  try {
    const data = localStorage.getItem(TEAM_REJOIN_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Validate that gameCode and teamName are non-empty strings
    if (
      typeof parsed.gameCode === "string" &&
      typeof parsed.teamName === "string" &&
      parsed.gameCode.length > 0 &&
      parsed.teamName.length > 0
    ) {
      // Check expiration
      if (parsed.savedAt && Date.now() - parsed.savedAt > EXPIRATION_MS) {
        clearTeamRejoin();
        return null;
      }
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
