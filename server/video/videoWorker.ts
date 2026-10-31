import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import {
  MAX_PHONE_VIDEO_BYTES,
  MAX_PHONE_VIDEO_SECONDS,
} from "../../shared/phoneVideo";
import { convertPhoneVideo, MediaProcessorError } from "./mediaProcessor";
import { downloadStoredVideo, uploadStoredFile, MediaStorageError } from "./mediaStorage";
import {
  cancelObsoleteClaimedVideoJob,
  claimNextVideoJob,
  completeClaimedVideoJob,
  failClaimedVideoJob,
  heartbeatVideoJob,
  newVideoOutputObjectKeys,
  recoverExpiredVideoJobs,
  type ClaimedVideoJob,
} from "./videoDb";

const RECOVERY_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_ID = `phone-video-${crypto.randomUUID()}`;

let started = false;
let rerunRequested = false;
let cyclePromise: Promise<void> | null = null;
let recoveryTimer: NodeJS.Timeout | undefined;
let activeAbortController: AbortController | undefined;

function sourceExtension(contentType: string): string {
  switch (contentType) {
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "video/3gpp":
      return "3gp";
    case "video/3gpp2":
      return "3g2";
    default:
      return "mp4";
  }
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Le traitement a été interrompu.", "AbortError");
  }
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "ABORT_ERR"))
  );
}

async function safeOutputFile(
  outputDirectory: string,
  filePath: string,
  limit: number
): Promise<number> {
  const [resolvedDirectory, resolvedFile] = await Promise.all([
    realpath(outputDirectory),
    realpath(filePath),
  ]);
  if (
    resolvedFile !== resolvedDirectory &&
    !resolvedFile.startsWith(`${resolvedDirectory}${sep}`)
  ) {
    throw new Error("Generated artifact is outside the job directory.");
  }
  const metadata = await stat(resolvedFile);
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size)) {
    throw new Error("Generated artifact is not a regular file.");
  }
  if (metadata.size <= 0 || metadata.size > limit) {
    throw new Error("Generated artifact exceeds permitted size.");
  }
  return metadata.size;
}

async function processClaim(job: ClaimedVideoJob): Promise<void> {
  const controller = new AbortController();
  activeAbortController = controller;
  const { signal } = controller;
  let heartbeatInFlight = false;
  let latestProgress = 0;

  const heartbeat = (progress: number) => {
    latestProgress = Math.max(
      latestProgress,
      Math.min(99, Math.floor(progress))
    );
    if (heartbeatInFlight || signal.aborted) return;
    heartbeatInFlight = true;
    void heartbeatVideoJob(job.jobId, job.leaseToken, latestProgress)
      .then(current => {
        // A cancellation, replacement, or reclaimed lease fences this process.
        if (!current) controller.abort();
      })
      .catch(() => {
        // A worker unable to prove its lease must stop rather than risk attachment.
        controller.abort();
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  };

  const heartbeatTimer = setInterval(
    () => heartbeat(latestProgress),
    HEARTBEAT_INTERVAL_MS
  );
  heartbeatTimer.unref();

  let jobDirectory: string | undefined;
  try {
    const initiallyCurrent = await heartbeatVideoJob(
      job.jobId,
      job.leaseToken,
      0
    );
    if (!initiallyCurrent) return;
    ensureNotAborted(signal);

    jobDirectory = await mkdtemp(join(tmpdir(), "ej-phone-video-"));
    const sourcePath = join(
      jobDirectory,
      `source.${sourceExtension(job.sourceContentType)}`
    );
    const outputDirectory = join(jobDirectory, "output");
    await mkdir(outputDirectory, { recursive: true });

    await downloadStoredVideo(
      job.sourceObjectKey,
      sourcePath,
      job.sourceSize,
      signal
    );
    ensureNotAborted(signal);

    const converted = await convertPhoneVideo({
      inputPath: sourcePath,
      outputDirectory,
      signal,
      onProgress: progress => heartbeat(progress),
    });
    ensureNotAborted(signal);

    if (
      !Number.isFinite(converted.durationSeconds) ||
      converted.durationSeconds <= 0 ||
      converted.durationSeconds > MAX_PHONE_VIDEO_SECONDS ||
      !Number.isFinite(converted.width) ||
      !Number.isFinite(converted.height) ||
      converted.width <= 0 ||
      converted.height <= 0
    ) {
      throw new Error("Converted metadata is outside allowed bounds.");
    }

    const [videoSize, posterSize] = await Promise.all([
      safeOutputFile(
        outputDirectory,
        converted.videoPath,
        MAX_PHONE_VIDEO_BYTES
      ),
      safeOutputFile(
        outputDirectory,
        converted.posterPath,
        MAX_PHONE_VIDEO_BYTES
      ),
    ]);
    ensureNotAborted(signal);

    const outputKeys = newVideoOutputObjectKeys(job.jobId);
    const [uploadedVideo, uploadedPoster] = await Promise.all([
      uploadStoredFile(
        outputKeys.videoKey,
        converted.videoPath,
        "video/mp4",
        signal
      ),
      uploadStoredFile(
        outputKeys.posterKey,
        converted.posterPath,
        "image/jpeg",
        signal
      ),
    ]);
    ensureNotAborted(signal);

    // Do not trust a storage adapter to rewrite the caller-supplied random key.
    if (
      uploadedVideo.key !== outputKeys.videoKey ||
      uploadedPoster.key !== outputKeys.posterKey ||
      uploadedVideo.size !== videoSize ||
      uploadedPoster.size !== posterSize
    ) {
      throw new Error(
        "Stored artifact metadata does not match generated files."
      );
    }

    const attached = await completeClaimedVideoJob(job.jobId, job.leaseToken, {
      video: { key: uploadedVideo.key, size: videoSize },
      poster: { key: uploadedPoster.key, size: posterSize },
      durationSeconds: converted.durationSeconds,
    });
    if (!attached) {
      await cancelObsoleteClaimedVideoJob(job.jobId, job.leaseToken);
    }
  } catch (error) {
    if (!isAbortError(error, signal)) {
      // Only a bounded, French-safe message is durable; no storage URL/error is logged.
      const safeMessage = error instanceof MediaProcessorError || error instanceof MediaStorageError
        ? error.message
        : undefined;
      await failClaimedVideoJob(job.jobId, job.leaseToken, safeMessage).catch(() => {
        // Lease recovery will safely reclaim an interrupted processing row.
      });
    }
  } finally {
    clearInterval(heartbeatTimer);
    if (jobDirectory) {
      await rm(jobDirectory, { recursive: true, force: true }).catch(() => {
        // Temporary cleanup failure is not allowed to expose filesystem details.
      });
    }
    if (activeAbortController === controller) activeAbortController = undefined;
  }
}

async function runCycle(): Promise<void> {
  do {
    rerunRequested = false;
    try {
      await recoverExpiredVideoJobs();
      while (started) {
        const job = await claimNextVideoJob(WORKER_ID);
        if (!job) break;
        await processClaim(job);
      }
    } catch {
      // The timer or a later poll will retry recovery. Avoid logging internal URLs.
    }
  } while (started && rerunRequested);
}

/** Starts non-blocking durable recovery after the parent confirms content readiness. */
export function startVideoWorker(): void {
  if (started) return;
  started = true;
  recoveryTimer = setInterval(kickVideoWorker, RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();
  kickVideoWorker();
}

/** Schedules work but never runs more than one conversion in this process. */
export function kickVideoWorker(): void {
  if (!started) return;
  rerunRequested = true;
  if (cyclePromise) return;
  cyclePromise = runCycle().finally(() => {
    cyclePromise = null;
    if (started && rerunRequested) kickVideoWorker();
  });
}

/** Stops timers and signals the active conversion; durable lease recovery remains safe. */
export async function stopVideoWorker(): Promise<void> {
  started = false;
  rerunRequested = false;
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = undefined;
  activeAbortController?.abort();
  await cyclePromise;
}
