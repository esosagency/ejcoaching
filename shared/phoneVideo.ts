/** Native phone-video upload contract shared by the admin client and server. */
export const MAX_PHONE_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_PHONE_VIDEO_SECONDS = 30 * 60;

/**
 * Accepted by the native picker as well as validated server-side. Extensions are
 * included because iOS frequently leaves File.type empty for camera-roll MOVs.
 */
export const PHONE_VIDEO_ACCEPT =
  ".mov,.mp4,.m4v,.webm,.3gp,.3g2,video/quicktime,video/mp4,video/x-m4v,video/webm,video/3gpp,video/3gpp2";

export type VideoJobStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

/** Deliberately excludes source object keys and all signed storage URLs. */
export type VideoJobInfo = {
  id: string;
  lessonId: string;
  status: VideoJobStatus;
  progress: number;
  filename: string;
  error?: string;
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
};

const extensionContentTypes: Record<string, string> = {
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
};

const acceptedReportedTypes = new Set([
  "video/quicktime",
  "video/mp4",
  "video/x-m4v",
  "video/webm",
  "video/3gpp",
  "video/3gpp2",
]);

/**
 * Returns the canonical storage content type for an allowed phone recording.
 * A blank reported MIME is intentionally accepted when its filename extension
 * is known, which covers Photos/iOS file pickers. M4V is normalized to MP4.
 */
export function getPhoneVideoContentType(
  filename: string,
  reportedType?: string | null
): string | null {
  const basename = filename.trim().split(/[\\/]/).pop() ?? "";
  const match = /\.([A-Za-z0-9]+)$/.exec(basename);
  if (!match) return null;

  const extension = match[1]!.toLowerCase();
  const inferred = extensionContentTypes[extension];
  if (!inferred) return null;

  const normalizedReported = (reportedType ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (normalizedReported && !acceptedReportedTypes.has(normalizedReported)) {
    return null;
  }

  return inferred;
}

export function isPhoneVideoStatusActive(status: VideoJobStatus): boolean {
  return (
    status === "uploading" || status === "queued" || status === "processing"
  );
}
