browser.runtime.onMessage.addListener(() => {
  const links = [];
  document
    .querySelectorAll(".comment-body a")
    .forEach((a) => links.push(a.href));
  return Promise.resolve({
    title: document.querySelector(".js-issue-title").innerText,
    links,
  });
});
