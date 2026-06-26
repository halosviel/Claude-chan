// ===========================================================================
//  datebox.js
//
//  The Japanese date panel in the left column: the month and day on top, and
//  the current time-of-day as a large kanji below (朝 morning / 昼 day /
//  夕 evening / 夜 night), in the style of a visual-novel date stamp.
// ===========================================================================

import { qs } from "./util/dom.js";

//
// Map an hour (0-23) to its time-of-day kanji.
//
function timeOfDay(hour) {
  if (hour >= 5 && hour < 11) {
    return "朝";
  }

  if (hour >= 11 && hour < 17) {
    return "昼";
  }

  if (hour >= 17 && hour < 20) {
    return "夕";
  }

  return "夜";
}

//
// Paint the current month/day and time-of-day into the date panel.
//
function paint(element) {
  const now = new Date();
  const ymd = (now.getMonth() + 1) + "月 " + now.getDate() + "日";
  const tod = timeOfDay(now.getHours());

  element.innerHTML =
    '<span class="vn-ymd">' + ymd + "</span>" +
    '<span class="vn-tod">' + tod + "</span>";
}

//
// Fill the date panel and keep it current (the time-of-day can change through
// the day). Called once at startup.
//
export function initDateBox() {
  const element = qs("#vn-date");

  if (!element) {
    return;
  }

  paint(element);
  setInterval(() => paint(element), 60000);
}
