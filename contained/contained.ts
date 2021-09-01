const DEFAULT_COOKIE_STOREID = "firefox-default";

type ContainerConfig = Omit<
  browser.contextualIdentities.ContextualIdentity,
  "cookieStoreId"
> & {
  domains: string[];
  entities: string[];
  enterAction?: "ask" | "switch";
  leaveAction?: "ask" | "default" | "stay";
};

type ExtensionConfig = {
  default: string;
  useTempContainers: boolean;
  tempContainerReplaceInterval: number;
  containers: ContainerConfig[];
};

type SwitcherPageMessage = {
  action: "replaceTab" | "keepTab";
  url: string;
  cookieStoreId?: string;
};

const DEFAULT_CONFIG: ExtensionConfig = {
  default: DEFAULT_COOKIE_STOREID,
  useTempContainers: true,
  tempContainerReplaceInterval: 120,
  containers: [
    {
      name: "Twitter",
      color: "turquoise",
      icon: "tree",
      domains: [],
      entities: ["Twitter, Inc."],
    },
    {
      name: "MS Work",
      color: "purple",
      icon: "briefcase",
      domains: ["*.duckduckgo.com", "duosecurity.com"],
      entities: ["Microsoft Corporation"],
      enterAction: "ask",
    },
    {
      name: "Facebook",
      icon: "fence",
      color: "blue",
      domains: ["facebook.com", "messenger.com"],
      entities: [],
      enterAction: "ask",
    },
    {
      name: "Google",
      color: "red",
      icon: "fruit",
      domains: [],
      entities: ["Google LLC"],
    },
    {
      name: "Google Anon",
      color: "yellow",
      icon: "fence",
      domains: [],
      entities: ["Google LLC"],
      leaveAction: "ask",
    },
  ],
};

class Container implements browser.contextualIdentities.ContextualIdentity {
  color: browser.contextualIdentities.IdentityColor;
  icon: browser.contextualIdentities.IdentityIcon;
  name: string;
  domains: Set<string>;

  constructor(public cookieStoreId: string, public config: ContainerConfig) {
    this.color = config.color;
    this.icon = config.icon;
    this.name = config.name;
    this.domains = new Set(config.domains);
  }
}

async function loadConfig(): Promise<ExtensionConfig> {
  const containers: ContainerConfig[] = [];
  const syncData = await browser.storage.sync.get(null);
  if (Object.keys(syncData).length === 0) {
    return DEFAULT_CONFIG;
  }
  Object.keys(syncData).forEach((name) => {
    containers.push(syncData[name] as ContainerConfig);
  });
  return {
    default: DEFAULT_COOKIE_STOREID,
    useTempContainers: DEFAULT_CONFIG.useTempContainers,
    tempContainerReplaceInterval: DEFAULT_CONFIG.tempContainerReplaceInterval,
    containers,
  };
}

async function storeConfig(config: ExtensionConfig) {
  const syncData = config.containers.reduce((prev, container) => {
    prev[container.name] = container;
    return prev;
  }, {});
  await browser.storage.sync.set(syncData);
}

let config: ExtensionConfig;
let containers: Container[];
let matcher: ContainerMatcher;
let tempContainerCounter = 1;

async function init() {
  config = await loadConfig();
  console.log("loaded config", config);
  (<any>window).config = config;
  window.storeConfig = storeConfig;
  containers = await syncContainers(config);
  // fetch entity list
  const tds = await (
    await fetch(
      "https://staticcdn.duckduckgo.com/trackerblocking/v2.1/tds.json",
      { credentials: "omit" }
    )
  ).json();
  // add domains from entity list to container domain lists
  containers.forEach((container) => {
    container.config.entities.forEach((entity) => {
      if (tds.entities[entity]) {
        tds.entities[entity].domains.forEach((domain) =>
          container.domains.add(domain)
        );
      }
    });
  });
  matcher = new ContainerMatcher(containers);
  // create a temp container
  const tempContainer = await createTempContainer();
  config.default = tempContainer.cookieStoreId;
}

async function start() {
  await init();
  const ignoreTabs = new Set();
  const tempContainers = new Set([config.default]);

  browser.webNavigation.onBeforeNavigate.addListener(
    async ({ tabId, url, frameId }) => {
      if (frameId !== 0 || !url.startsWith("http")) {
        // ignore non top-level navigation
        return;
      }
      if (ignoreTabs.has(tabId)) {
        // ignore navigations from this tab (user chose not to switch)
        return;
      }
      const domain = new URL(url).hostname;
      const tab = await browser.tabs.get(tabId);
      const isMatchingTabContainer = ({ cookieStoreId }) =>
        tab.cookieStoreId === cookieStoreId;
      const matchedContainers = matcher.lookup(domain);
      const isInMatchedContainer =
        matchedContainers.findIndex(isMatchingTabContainer) !== -1;
      if (isInMatchedContainer) {
        // already in a matching container tab for this domain - nothing to do
      } else if (matchedContainers.length === 1) {
        const cont = matchedContainers[0];
        switch (cont.config.enterAction) {
          case "ask":
            await askWhichContainerToUse(tabId, url, matchedContainers);
            break;
          case "switch":
          default:
            await replaceTab(tabId, url, cont.cookieStoreId);
        }
      } else if (matchedContainers.length > 1) {
        // ask which container to switch to
        await askWhichContainerToUse(tabId, url, matchedContainers);
      } else if (
        matchedContainers.length === 0 &&
        tab.cookieStoreId !== config.default &&
        !tempContainers.has(tab.cookieStoreId)
      ) {
        // this tab should not be an a container but is
        const cont = containers.find(isMatchingTabContainer);
        switch (cont?.config?.leaveAction) {
          case "ask":
            await askWhichContainerToUse(tabId, url, [
              {
                name: "default",
                cookieStoreId: config.default,
                color: "toolbar",
              },
            ]);
            break;
          case "stay":
            break;
          case "default":
          default:
            await replaceTab(tabId, url, config.default);
        }
      }
      console.log(
        "navigate",
        tab.id,
        url,
        matchedContainers,
        isInMatchedContainer
      );
    }
  );

  // listen for messages from moz-extension page
  browser.runtime.onMessage.addListener(
    (msg: SwitcherPageMessage, sender: browser.runtime.MessageSender) => {
      const { action, url, cookieStoreId } = msg;
      if (action === "keepTab") {
        ignoreTabs.add(sender.tab.id);
        browser.tabs.update(sender.tab.id, {
          url: msg.url,
        });
      } else if (action === "replaceTab") {
        replaceTab(sender.tab.id, url, cookieStoreId);
      }
    }
  );

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      console.log("config changed, reloading");
      init();
    }
  });

  // Periodically create a new default container
  const ALARM_TEMP_ROTATE = "rotateTempContainers";
  browser.alarms.create(ALARM_TEMP_ROTATE, {
    periodInMinutes: config.tempContainerReplaceInterval,
  });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_TEMP_ROTATE && config.useTempContainers) {
      const tempContainer = await createTempContainer();
      config.default = tempContainer.cookieStoreId;
      tempContainers.add(tempContainer.cookieStoreId);
    }
  });
}

async function syncContainers(config: ExtensionConfig) {
  const containers = await browser.contextualIdentities.query({});
  // find matching containers or create new ones
  const linkedContainers = await Promise.all(
    config.containers.map(async (conf) => {
      const { name, icon, color } = conf;
      const match = containers.find(
        ({ name: existingName }) => existingName === name
      );
      if (match) {
        if (match.color !== color || match.icon !== icon) {
          console.log("update container", name);
          await browser.contextualIdentities.update(match.cookieStoreId, {
            name,
            icon,
            color,
          });
        }
        return new Container(match.cookieStoreId, conf);
      } else {
        console.log("create container", name);
        const c = await browser.contextualIdentities.create({
          name,
          icon,
          color,
        });
        return new Container(c.cookieStoreId, conf);
      }
    })
  );
  // remove other containers
  const containerIds = linkedContainers.map(
    ({ cookieStoreId }) => cookieStoreId
  );
  await Promise.all(
    containers
      .filter(({ cookieStoreId }) => !containerIds.includes(cookieStoreId))
      .map(({ cookieStoreId, name }) => {
        console.log("remove container", name);
        return browser.contextualIdentities.remove(cookieStoreId);
      })
  );
  return linkedContainers;
}

interface DomainTrie {
  $?: Container[];
  s?: { [key: string]: DomainTrie };
}

class ContainerMatcher {
  trie: DomainTrie = {
    s: {},
  };

  constructor(containers: Container[]) {
    containers.forEach((container) => {
      container.domains.forEach((domain) => {
        this._insert(domain.split(".").reverse(), container);
      });
    });
  }

  _insert(parts: string[], container: Container, trie = this.trie) {
    if (parts.length === 0) {
      if (!trie.$) {
        trie.$ = [];
      }
      trie.$.push(container);
      return;
    }
    if (!trie.s) {
      trie.s = {};
    }
    if (!trie.s[parts[0]]) {
      trie.s[parts[0]] = {};
    }
    this._insert(parts.slice(1), container, trie.s[parts[0]]);
  }

  lookup(domain: string): Container[] {
    return this._lookup(domain.split(".").reverse());
  }

  _lookup(parts: string[], trie = this.trie): Container[] {
    if (parts.length > 0 && trie.s) {
      if (trie.s[parts[0]]) {
        return this._lookup(parts.slice(1), trie.s[parts[0]]);
      } else if (trie.s["*"]) {
        return this._lookup(parts.slice(1), trie.s["*"]);
      }
    }
    return trie.$ || [];
  }
}

async function replaceTab(tabId: number, url: string, cookieStoreId: string) {
  console.log("replace tab", tabId, url, cookieStoreId);
  const tab = await browser.tabs.get(tabId);
  await Promise.all([
    browser.tabs.remove(tabId),
    browser.tabs.create({
      cookieStoreId,
      url,
      active: tab.active,
      index: tab.index,
      openerTabId: tab.openerTabId,
      pinned: tab.pinned,
      windowId: tab.windowId,
    }),
  ]);
}

async function askWhichContainerToUse(
  tabId: number,
  url: string,
  options: Pick<Container, "name" | "cookieStoreId" | "color">[]
) {
  const switcherUrl = new URL(browser.runtime.getURL("switcher.html"));
  switcherUrl.searchParams.append("url", `${url}`);
  switcherUrl.searchParams.append("options", JSON.stringify(options));
  await browser.tabs.update(tabId, {
    url: switcherUrl.href,
  });
}

function createTempContainer() {
  return browser.contextualIdentities.create({
    name: `Temp ${tempContainerCounter++}`,
    color: "toolbar",
    icon: "circle",
  });
}

start();
