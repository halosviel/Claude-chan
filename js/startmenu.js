// ===========================================================================
//  startmenu.js
//
//  The XP-style Start menu: a tall panel that pops above the Start button. Its
//  items open the Memory window, restart (reload) the app, or power off (close
//  the tab, falling back to a shutdown screen). Clicking elsewhere or pressing
//  Escape closes it.
// ===========================================================================

import { qs } from "./util/dom.js";
import { dlog } from "./log.js";
import { playSound } from "./util/sound.js";
import { showWindowCentered } from "./windowing.js";

//
// True when the Start menu is currently open.
//
function isOpen(menu) {
  return menu && menu.style.display !== "none";
}

//
// Show the Start menu.
//
function open(menu) {
  if (menu) {
    menu.style.display = "flex";
  }
}

//
// Hide the Start menu.
//
function close(menu) {
  if (menu) {
    menu.style.display = "none";
  }
}

//
// Wire the Start button, its menu items, and the global close-on-click /
// close-on-Escape behavior. Called once at startup.
//
export function initStartMenu() {
  const startBtn = qs("#start-btn");
  const startMenu = qs("#start-menu");

  if (startBtn) {
    startBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      playSound("app-open");

      if (isOpen(startMenu)) {
        close(startMenu);
      } else {
        open(startMenu);
      }
    });
  }

  if (startMenu) {
    startMenu.addEventListener("click", (event) => event.stopPropagation());
  }

  document.addEventListener("click", () => {
    if (isOpen(startMenu)) {
      close(startMenu);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close(startMenu);
    }
  });

  const memoryBtn = qs("#start-memory");

  if (memoryBtn) {
    memoryBtn.addEventListener("click", () => {
      close(startMenu);

      const win = qs("#win-memory");

      if (win) {
        showWindowCentered(win);
      }

      dlog("start menu -> memory");
    });
  }

  const restartBtn = qs("#start-restart");

  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      close(startMenu);
      dlog("start menu -> restart (reload)");
      location.reload();
    });
  }

  const powerBtn = qs("#start-poweroff");

  if (powerBtn) {
    powerBtn.addEventListener("click", () => {
      close(startMenu);
      dlog("start menu -> power off (close window)");
      window.close();

      setTimeout(() => {
        const screen = qs("#shutdown-screen");

        if (screen) {
          screen.style.display = "flex";
        }
      }, 150);
    });
  }
}
