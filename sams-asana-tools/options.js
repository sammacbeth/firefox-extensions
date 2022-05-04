const inputElement = document.getElementById("accessToken");

document.querySelector("form").addEventListener("submit", () => {
  browser.storage.local.set({ accessToken: inputElement.value });
});

(async () => {
  const { accessToken } = await browser.storage.local.get("accessToken");
  if (accessToken) {
    inputElement.value = accessToken;
  }
})();
