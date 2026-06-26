// ===========================================================================
//  time.js
//
//  Reusable time formatting: a 12-hour clock and a relative timestamp
//  ("6:12 PM", "yesterday", "3 days ago", "last week", ...).
// ===========================================================================

//
// Format a Date as a 12-hour clock like "6:12 PM".
//
export function formatClock(date) {
  let hours = date.getHours();
  const ampm = hours < 12 ? "AM" : "PM";
  const minutes = String(date.getMinutes()).padStart(2, "0");

  hours = hours % 12;

  if (hours === 0) {
    hours = 12;
  }

  return hours + ":" + minutes + " " + ampm;
}

//
// Start-of-day for a date (midnight), used to compare by calendar day.
//
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

//
// Format a Date relative to `now`: the clock time if it's today, otherwise a
// coarse relative phrase. Reusable anywhere a friendly timestamp is needed.
//
export function formatRelativeTime(date, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (days <= 0) {
    return formatClock(date);
  }

  if (days === 1) {
    return "yesterday";
  }

  if (days < 7) {
    return days + " days ago";
  }

  if (days < 14) {
    return "last week";
  }

  const weeks = Math.floor(days / 7);

  return weeks + " weeks ago";
}
