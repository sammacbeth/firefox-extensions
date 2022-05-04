browser.pageAction.onClicked.addListener(async (tab) => {
  const { accessToken } = await browser.storage.local.get("accessToken");
  if (!accessToken) {
    // if no accessToken has been saved, open the options page to prompt the user to add one
    await browser.runtime.openOptionsPage();
    return;
  }
  const client = Asana.Client.create().useAccessToken(accessToken);

  const { title, links } = await browser.tabs.sendMessage(tab.id, "issueInfo");
  const firstTaskLink = links
    .map((l) => l.match(/https:\/\/app\.asana\.com\/0\/\d+\/(\d+)\//))
    .find((v) => v !== null);
  if (firstTaskLink) {
    console.log("Found parent task", firstTaskLink);
    try {
      // const parentTask = await client.tasks.getTask(firstTaskLink[1]);
      const task = await client.tasks.createTask({
        assignee: "me",
        followers: ["me"],
        name: `PR - ${title}`,
        notes: `${tab.url}`,
        parent: firstTaskLink[1],
        // workspace: parentTask.workspace.gid
      });
      browser.tabs.create({
        url: `https://app.asana.com/0/0/${task.gid}/f`,
      });
      console.log("Created task", task);
    } catch (e) {
      console.error("Failed to create task", e);
    }
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.runtime.openOptionsPage();
});
