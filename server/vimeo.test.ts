import { describe, expect, it } from "vitest";
import { getVimeoEmbedUrl, parseVimeoUrl } from "../shared/vimeo";
import { isAllowedVideoUrl } from "../client/src/pages/admin/AdminEditor";
import { isRecognizedVideoEmbed } from "./contentValidation";

const videoId = "123456789";
const privacyHash = "aB12cD34eF";

function expectVimeoValidatorsToAgree(value: string, expected: boolean) {
  expect(isRecognizedVideoEmbed(value)).toBe(expected);
  expect(isAllowedVideoUrl(value)).toBe(expected);
}

describe("Vimeo URL normalisation", () => {
  it("normalise une vidéo publique vers le lecteur Vimeo approuvé", () => {
    const value = `https://vimeo.com/${videoId}`;

    expect(parseVimeoUrl(value)).toEqual({ id: videoId });
    expect(getVimeoEmbedUrl(value)).toBe(
      `https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0`
    );
    expectVimeoValidatorsToAgree(value, true);
  });

  it("préserve exactement le hash privé d’un lien non répertorié et écarte autoplay", () => {
    const value = `https://vimeo.com/${videoId}/${privacyHash}?autoplay=1&title=1&byline=1&portrait=1`;

    expect(parseVimeoUrl(value)).toEqual({
      id: videoId,
      privacyHash,
    });
    expect(getVimeoEmbedUrl(value)).toBe(
      `https://player.vimeo.com/video/${videoId}?h=${privacyHash}&title=0&byline=0&portrait=0`
    );
    expect(getVimeoEmbedUrl(value)).not.toContain("autoplay");
    expectVimeoValidatorsToAgree(value, true);
  });

  it("conserve le hash h d’une URL player Vimeo et accepte les paramètres inoffensifs", () => {
    const value = `https://player.vimeo.com/video/${videoId}?h=${privacyHash}&muted=1&autopause=0`;

    expect(parseVimeoUrl(value)).toEqual({
      id: videoId,
      privacyHash,
    });
    expect(getVimeoEmbedUrl(value)).toBe(
      `https://player.vimeo.com/video/${videoId}?h=${privacyHash}&title=0&byline=0&portrait=0`
    );
    expectVimeoValidatorsToAgree(value, true);
  });

  it.each([
    `http://vimeo.com/${videoId}`,
    `https://editor:secret@vimeo.com/${videoId}`,
    `https://player.vimeo.com.evil.example/video/${videoId}`,
    `https://vimeo.com:444/${videoId}`,
    `https://player.vimeo.com/video/${videoId}?h=`,
    `https://player.vimeo.com/video/${videoId}?h=abc`,
    `https://vimeo.com/${videoId}/bad_hash`,
    `https://vimeo.com/${videoId}/${privacyHash}?h=OtherHash9`,
  ])("rejette une URL Vimeo non sûre ou un hash privé invalide: %s", value => {
    expect(parseVimeoUrl(value)).toBeNull();
    expect(getVimeoEmbedUrl(value)).toBeNull();
    expectVimeoValidatorsToAgree(value, false);
  });
});
