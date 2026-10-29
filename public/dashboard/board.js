// The board a dashboard page shows (?board=cb3, else CB2): its name in the page, links that keep the
// board, a switch to the other boards, and where its data files are (scripts/build_*.py write them).

import { BOARD, withBoard } from "/js/util.js";

export const dataUrl = (file) => `/dashboard/data/${BOARD}/${file}`;

/** Fills in the board's name and links from /api/config, and returns the config. */
export async function showBoard() {
  const config = await (await fetch("/api/config", { headers: { "x-board": BOARD } })).json();
  const { board, boards } = config;
  for (const el of document.querySelectorAll("[data-board-name]")) el.textContent = board.name;
  document.title = document.title.replace("CB2 Manhattan", board.name);
  for (const a of document.querySelectorAll("a[href^='/']")) a.href = withBoard(a.getAttribute("href"));
  const page = location.pathname;
  document.getElementById("boardSwitch").innerHTML = `<strong>Board</strong>` + boards.map((b) =>
    b.id === board.id ? `<span aria-current="true">${b.short}</span>` : `<a href="${b.id === "cb2" ? page : `${page}?board=${b.id}`}">${b.short}</a>`).join("");
  return config;
}
