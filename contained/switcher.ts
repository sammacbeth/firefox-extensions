const params = new URL(document.location.href).searchParams;
const url = params.get("url");
const options: Container[] = JSON.parse(params.get("options"));
const buttonTmpl = document.getElementById("switcher-button");
const buttonsContainer = document.getElementById("buttons");
const buttons: Array<HTMLElement> = [document.getElementById("no-switch")];

document.getElementById("url").innerText = url;

buttons[0].addEventListener("click", () => {
  browser.runtime.sendMessage({
    action: "keepTab",
    url,
  });
});

options.forEach((container) => {
  if (buttonTmpl instanceof HTMLTemplateElement) {
    buttonsContainer.appendChild(buttonTmpl.content.cloneNode(true));
    const btnElement = document.querySelector("#buttons > button:last-child");
    const index = buttons.push(btnElement as HTMLElement) - 1;
    btnElement.textContent = `Use ${container.name} (${index})`;
    // rough mapping from container colors to bulma button colors
    switch (container.color) {
      case "blue":
        btnElement.classList.add("is-link");
        break;
      case "turquoise":
        btnElement.classList.add("is-primary");
        break;
      case "green":
        btnElement.classList.add("is-success");
        break;
      case "orange":
        btnElement.classList.add("is-warning", "is-light");
        break;
      case "pink":
        btnElement.classList.add("is-danger", "is-light");
        break;
      case "purple":
        btnElement.classList.add("is-link");
        break;
      case "red":
        btnElement.classList.add("is-danger");
        break;
      case "yellow":
        btnElement.classList.add("is-warning");
        break;
      case "toolbar":
        btnElement.classList.add("is-dark");
        break;
    }
    btnElement.addEventListener("click", () => {
      browser.runtime.sendMessage({
        action: "replaceTab",
        url,
        cookieStoreId: container.cookieStoreId,
      });
    });
  }
});

// respond to key events
document.addEventListener("keydown", (event) => {
  const num = event.key.charCodeAt(0) - "0".charCodeAt(0);
  if (buttons.length > num) {
    buttons[num].click();
  }
});
