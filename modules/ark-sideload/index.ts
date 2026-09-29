// ArkStore on iPhone signing and installing apps on the iPhone itself (sideload/ in Rust,
// linked by ios/ArkSideload.podspec). Missing on Android, web and desktop, and in iPhone builds
// made without the Rust library: callers check `arkSideload` before offering it.
import { requireOptionalNativeModule } from 'expo';

type ArkSideloadNative = {
  /** Starts a job (see sideload/src/lib.rs for the commands); returns its handle. */
  start(command: string, requestJson: string): number;
  /** The job's next event as JSON, or null when there's none yet. */
  next(job: number): string | null;
  answer(job: number, answerJson: string): void;
  cancel(job: number): void;
};

export const arkSideload = requireOptionalNativeModule<ArkSideloadNative>('ArkSideload');
