(() => {
  const saved = localStorage.getItem("themeMode");
  const mode = ["system", "light", "dark"].includes(saved) ? saved : "system";
  document.documentElement.dataset.theme = mode;
})();
