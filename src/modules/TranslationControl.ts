type ProgressUpdater = (text: string, type?: "success" | "fail" | "default") => void;

export class TranslationStopError extends Error {
  constructor() {
    super("Full Text Translate stop requested");
    this.name = "TranslationStopError";
  }
}

export class TranslationControl {
  private static stopRequested = false;

  private static readonly progressUpdaters = new Set<ProgressUpdater>();

  static beginRun() {
    this.stopRequested = false;
  }

  static requestStopAll() {
    this.stopRequested = true;
    for (const update of this.progressUpdaters) {
      try {
        update("已请求停止，等待当前步骤结束…", "default");
      } catch {
        // ignore detached progress windows
      }
    }
  }

  static registerProgress(updater: ProgressUpdater) {
    this.progressUpdaters.add(updater);
  }

  static unregisterProgress(updater: ProgressUpdater) {
    this.progressUpdaters.delete(updater);
  }

  static throwIfStopped() {
    if (this.stopRequested) {
      throw new TranslationStopError();
    }
  }

  static isStopError(error: unknown) {
    return error instanceof TranslationStopError;
  }
}
