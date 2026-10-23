// From the first moment of the page: what shows (splash, shell, skeletons, Home's first names),
// each time it changes, in window.__boot.
const boot: string[] = [];
(window as unknown as { __boot: string[] }).__boot = boot;
let last = "";
const look = () => {
  const names = [...document.querySelectorAll(".card .card-title, .shortcut-title")].slice(0, 3).map((e) => e.textContent);
  const now = `splash=${!!document.querySelector(".splash")} shell=${!!document.querySelector(".shell")} skeletons=${document.querySelectorAll(".sk").length} library=${document.querySelectorAll(".side-leaf").length} home=${names.join(" | ")}`;
  if (now === last) return;
  last = now;
  boot.push(`${Math.round(performance.now())} ms  ${now}`);
};
new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });

// ?liveblur: the aura with the old live CSS blur, for comparing with the baked one.
if (location.search.includes("liveblur")) localStorage.setItem("auraLiveBlur", "1");
else localStorage.removeItem("auraLiveBlur");

// ?auraonly: everything but the aura hidden, to look at the aura alone.
if (location.search.includes("auraonly")) {
  const s = document.createElement("style");
  s.textContent = ".shell > *:not(.aura), .playerbar, .aura-grain { visibility: hidden !important; } .aura-blob { animation: none !important; }";
  document.head.append(s);
}

// ?settings: opens Settings at the progress bar, for a picture of it.
if (location.search.includes("settings")) {
  setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true })), 1200);
  setTimeout(() => [...document.querySelectorAll<HTMLElement>("button, a")].find((e) => /^(Progress bar|Barra de progresso)$/.test(e.textContent?.trim() ?? ""))?.click(), 2200);
}
