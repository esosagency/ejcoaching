import { describe, expect, it } from "vitest";
import { formatVideoDuration, toVideoJobInfo } from "./videoDb";

describe("video job DTO serialization", () => {
  const base = {
    id: "job_123",
    lessonId: "lesson_123",
    status: "ready" as const,
    progress: 117,
    filename: "IMG_1234.MOV",
    error: "internal source key must not escape",
    durationSeconds: 61,
  };

  it("returns generated output URLs only for ready work and clamps progress", () => {
    expect(
      toVideoJobInfo(base, {
        videoUrl: "/manus-storage/phone-video/output/job/video.mp4",
        posterUrl: "/manus-storage/phone-video/output/job/poster.jpg",
      })
    ).toEqual({
      id: "job_123",
      lessonId: "lesson_123",
      status: "ready",
      progress: 100,
      filename: "IMG_1234.MOV",
      videoUrl: "/manus-storage/phone-video/output/job/video.mp4",
      posterUrl: "/manus-storage/phone-video/output/job/poster.jpg",
      durationSeconds: 61,
    });
  });

  it("does not expose output or error fields while a job is pending", () => {
    expect(
      toVideoJobInfo(
        { ...base, status: "processing", progress: -10 },
        {
          videoUrl: "/manus-storage/source/secret.mov",
          posterUrl: "/manus-storage/source/secret.jpg",
        }
      )
    ).toEqual({
      id: "job_123",
      lessonId: "lesson_123",
      status: "processing",
      progress: 0,
      filename: "IMG_1234.MOV",
    });
  });

  it("formats generated lesson durations consistently", () => {
    expect(formatVideoDuration(0.2)).toBe("00:01");
    expect(formatVideoDuration(61.4)).toBe("01:01");
    expect(formatVideoDuration(3_661)).toBe("61:01");
  });
});
