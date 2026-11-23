// Weeks that start on Monday or Sunday, in the device's time zone.
// Mirrors public.week_start_of() in the database.
import { isoDate, parseDate, addDays, range } from './util.js';

const DAY = 864e5;

export function weekStartOf(dateStr, weekStart) {
  const d = parseDate(dateStr);
  const isoDow = ((d.getDay() + 6) % 7) + 1;            // Monday 1 … Sunday 7
  const startDow = weekStart === 'sunday' ? 7 : 1;
  return addDays(dateStr, -((isoDow - startDow + 7) % 7));
}

// ISO week number of the week that contains `dateStr` (Monday-based by definition).
export function isoWeekNumber(dateStr) {
  const d = parseDate(dateStr);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week1 = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7));
  return 1 + Math.round((thursday - week1 - 3 * DAY) / (7 * DAY));
}

export function weekOf(now = new Date(), weekStart = 'monday') {
  const today = isoDate(now);
  const start = weekStartOf(today, weekStart);
  const end = addDays(start, 6);
  const elapsed = Math.round((parseDate(today) - parseDate(start)) / DAY);
  return {
    id: start,                 // a week is named by its first day
    start,
    end,
    today,
    weekStart,
    number: isoWeekNumber(start),
    daysLeft: 7 - elapsed,
    days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
  };
}

// The same week shifted by `n` weeks (negative = earlier).
export function shiftWeek(week, n) {
  const start = addDays(week.start, 7 * n);
  return {
    ...week,
    id: start,
    start,
    end: addDays(start, 6),
    number: isoWeekNumber(start),
    days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
  };
}

// Header words: Monday weeks show their ISO number, Sunday weeks their dates.
export function weekTitle(week) {
  return week.weekStart === 'sunday' ? range(week.start, week.end) : `Week ${week.number}`;
}

export function weekSubtitle(week, isCurrent) {
  const left = week.daysLeft === 1 ? 'resets tonight' : `${week.daysLeft} days left`;
  if (week.weekStart === 'sunday') return isCurrent ? left : 'Past week';
  return isCurrent ? `${range(week.start, week.end)} · ${left}` : `${range(week.start, week.end)} · past week`;
}

export const resetDayName = weekStart => (weekStart === 'sunday' ? 'Sunday' : 'Monday');
