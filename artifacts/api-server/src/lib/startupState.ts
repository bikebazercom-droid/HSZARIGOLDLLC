export type StartupState = {
  ready: boolean;
  step: string | null;
};

let startupState: StartupState = {
  ready: false,
  step: "server_starting",
};

export function setStartupStep(step: string): void {
  startupState = { ready: false, step };
}

export function markStartupReady(): void {
  startupState = { ready: true, step: null };
}

export function getStartupState(): StartupState {
  return startupState;
}
