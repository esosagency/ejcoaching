const VIMEO_WATCH_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
const VIMEO_PLAYER_HOST = "player.vimeo.com";
const VIMEO_VIDEO_ID = /^\d{1,16}$/;
const VIMEO_PRIVACY_HASH = /^[A-Za-z0-9]{6,128}$/;

export type VimeoVideo = Readonly<{
  id: string;
  privacyHash?: string;
}>;

/**
 * Parses the supported Vimeo watch and player URL forms without retaining
 * arbitrary player options. A supplied `h` parameter must be a valid privacy
 * hash so a private-video credential is never silently discarded.
 */
export function parseVimeoUrl(value: string): VimeoVideo | null {
  const input = value.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (!VIMEO_WATCH_HOSTS.has(host) && host !== VIMEO_PLAYER_HOST)
  ) {
    return null;
  }

  const suppliedHashes = url.searchParams.getAll("h");
  if (
    suppliedHashes.length > 1 ||
    (suppliedHashes.length === 1 &&
      !VIMEO_PRIVACY_HASH.test(suppliedHashes[0]!))
  ) {
    return null;
  }
  const queryHash = suppliedHashes[0];

  let id: string | undefined;
  let pathHash: string | undefined;

  if (VIMEO_WATCH_HOSTS.has(host)) {
    const match = url.pathname.match(
      /^\/(\d{1,16})(?:\/([A-Za-z0-9]{6,128}))?\/?$/
    );
    if (!match) return null;
    [, id, pathHash] = match;
  } else {
    const match = url.pathname.match(/^\/video\/(\d{1,16})\/?$/);
    if (!match) return null;
    [, id] = match;
  }

  if (!id || !VIMEO_VIDEO_ID.test(id)) return null;
  if (pathHash && queryHash && pathHash !== queryHash) return null;

  return {
    id,
    ...(pathHash || queryHash ? { privacyHash: pathHash ?? queryHash } : {}),
  };
}

/**
 * Returns the trusted Vimeo iframe source for a supported Vimeo URL.
 * Privacy hashes are preserved exactly; arbitrary and autoplay parameters are
 * intentionally omitted.
 */
export function getVimeoEmbedUrl(value: string): string | null {
  const video = parseVimeoUrl(value);
  if (!video) return null;

  const params = new URLSearchParams();
  if (video.privacyHash) params.set("h", video.privacyHash);
  params.set("title", "0");
  params.set("byline", "0");
  params.set("portrait", "0");

  return `https://${VIMEO_PLAYER_HOST}/video/${video.id}?${params.toString()}`;
}
