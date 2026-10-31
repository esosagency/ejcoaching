import { describe, expect, it } from 'vitest';
import { allLessons, courses, getCourse, totalMinutes } from './courses';

describe('EJ Coaching sample course catalog', () => {
  it('covers every requested education topic without duplicate course identifiers', () => {
    expect(courses.map(course => course.id)).toEqual(['nutrition', 'training', 'mindset', 'deficit', 'surplus', 'equipment', 'supplements']);
    expect(new Set(courses.map(course => course.id)).size).toBe(courses.length);
  });
  it('provides distinct valid lesson identifiers and positive sample durations', () => {
    expect(new Set(allLessons.map(lesson => lesson.id)).size).toBe(allLessons.length);
    for (const course of courses) {
      expect(getCourse(course.id)).toBe(course);
      expect(course.lessons.length).toBeGreaterThan(0);
      expect(totalMinutes(course)).toBeGreaterThan(0);
      for (const lesson of course.lessons) {
        expect(lesson.id.startsWith(`${course.id}-`)).toBe(true);
        expect(lesson.duration).toMatch(/^\d{2}:[0-5]\d$/);
        expect(lesson.takeaways.length).toBeGreaterThan(0);
      }
    }
  });
  it('does not invent a course for an unknown URL identifier', () => {
    expect(getCourse('missing-course')).toBeUndefined();
  });
});
