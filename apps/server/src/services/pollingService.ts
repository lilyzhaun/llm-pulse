export class PollingService {
  private timer: NodeJS.Timeout | undefined;
  private isTickRunning = false;

  start(onTick: () => Promise<void>, intervalMs: number): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runTick(onTick);
    }, intervalMs);
  }

  async runNow(onTick: () => Promise<void>): Promise<void> {
    await this.runTick(onTick);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async runTick(onTick: () => Promise<void>): Promise<void> {
    if (this.isTickRunning) {
      return;
    }

    this.isTickRunning = true;
    try {
      await onTick();
    } finally {
      this.isTickRunning = false;
    }
  }
}

export const pollingService = new PollingService();
