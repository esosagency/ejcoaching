import { describe, expect, it } from "vitest";
import {
  MAX_PHONE_VIDEO_BYTES,
  MAX_PHONE_VIDEO_SECONDS,
  getPhoneVideoContentType,
  isPhoneVideoStatusActive,
} from "../shared/phoneVideo";

describe("phone video contract", () => {
  it("infers accepted iPhone/phone source types when MIME is blank", () => {
    expect(getPhoneVideoContentType("IMG_1234.MOV", "")).toBe(
      "video/quicktime"
    );
    expect(getPhoneVideoContentType("clip.m4v")).toBe("video/mp4");
    expect(getPhoneVideoContentType("camera.3GP", undefined)).toBe(
      "video/3gpp"
    );
    expect(getPhoneVideoContentType("camera.3g2", undefined)).toBe(
      "video/3gpp2"
    );
  });

  it("fails closed for an unknown extension or non-video claimed MIME", () => {
    expect(getPhoneVideoContentType("video.avi", "video/mp4")).toBeNull();
    expect(getPhoneVideoContentType("video.mov", "application/pdf")).toBeNull();
    expect(getPhoneVideoContentType("../../video.mov", "video/quicktime")).toBe(
      "video/quicktime"
    );
  });

  it("publishes the approved source limits and only treats unfinished jobs as active", () => {
    expect(MAX_PHONE_VIDEO_BYTES).toBe(1024 * 1024 * 1024);
    expect(MAX_PHONE_VIDEO_SECONDS).toBe(1800);
    expect(isPhoneVideoStatusActive("uploading")).toBe(true);
    expect(isPhoneVideoStatusActive("processing")).toBe(true);
    expect(isPhoneVideoStatusActive("ready")).toBe(false);
    expect(isPhoneVideoStatusActive("failed")).toBe(false);
    expect(isPhoneVideoStatusActive("cancelled")).toBe(false);
  });
});
