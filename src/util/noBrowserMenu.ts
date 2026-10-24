// No browser menu (Back, Refresh, Print, Save as) on a right click anywhere: the app's own menus
// open where they exist. Text fields keep it, for cut, copy and paste. Imported once, for its effect.
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest("input, textarea") || el?.isContentEditable) return;
  e.preventDefault();
});

export {};
