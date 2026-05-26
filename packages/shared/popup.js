const CHANNEL_LIST_KEY = "channelListV1";

// These are youtube's official channels like "Shopping", "Music", etc that show up in the sidebar that we want to ignore.
const EXCLUDED_CHANNEL_PATHS = new Set([
  "/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ",
  "/channel/UCkYQyvc_i9hXEo4xic9Hh2g",
  "/channel/UCEgdi0XIXXZ-qJOFPf4JSKw",
  "/channel/UCrpQ4p1Ql_hG8rKXIKM1MOQ",
  "/channel/UCtFRv9O2AHqOZjjynzrv-xg",
  "/channel/UCYfdidRxbB8Qhf0Nx7ioOYw",
  "/channel/UC4R8DWoMoI7CAwX8_LjQHig"
]);

const tabLive = document.getElementById("tabLive");
const tabAll = document.getElementById("tabAll");
const panelLive = document.getElementById("panelLive");
const panelAll = document.getElementById("panelAll");

const refreshLiveBtn = document.getElementById("refreshLiveBtn");
const liveCount = document.getElementById("liveCount");
const liveHint = document.getElementById("liveHint");
const liveList = document.getElementById("liveList");

const scanBtn = document.getElementById("scanBtn");
const scanHint = document.getElementById("scanHint");
const channelList = document.getElementById("channelList");
const channelCount = document.getElementById("channelCount");

tabLive.addEventListener("click", () => switchTab("live"));
tabAll.addEventListener("click", () => switchTab("all"));
refreshLiveBtn.addEventListener("click", () => refreshLiveList(true));
scanBtn.addEventListener("click", scanFromYouTube);

initialize().catch(console.error);

async function initialize() {
  switchTab("live");
  const channels = await getChannelList();
  renderAllChannels(channels);
  await refreshLiveList(false);
}

function switchTab(tab) {
  const isLive = tab === "live";
  tabLive.classList.toggle("tab--active", isLive);
  tabAll.classList.toggle("tab--active", !isLive);
  tabLive.setAttribute("aria-selected", String(isLive));
  tabAll.setAttribute("aria-selected", String(!isLive));
  panelLive.classList.toggle("tab-panel--hidden", !isLive);
  panelAll.classList.toggle("tab-panel--hidden", isLive);

  if (isLive) {
    void refreshLiveList(false);
  }
}

async function refreshLiveList(forceRefresh) {
  refreshLiveBtn.disabled = true;
  refreshLiveBtn.textContent = "Refreshing…";
  liveHint.hidden = true;

  try {
    const channels = await fetchLiveChannels(forceRefresh);
    renderLiveChannels(channels);

    if (!channels.length) {
      setLiveHint("None of your included subscriptions are live right now.", false);
    }
  } catch (error) {
    setLiveHint(`Could not load live channels: ${error.message}`, true);
  } finally {
    refreshLiveBtn.disabled = false;
    refreshLiveBtn.textContent = "Refresh Live";
  }
}

function renderLiveChannels(channels) {
  liveList.textContent = "";

  const sorted = channels.slice().sort((a, b) => a.title.localeCompare(b.title));
  liveCount.textContent = `${sorted.length} live`;

  for (const channel of sorted) {
    const li = document.createElement("li");
    li.className = "channel-item";

    const img = document.createElement("img");
    img.className = "channel-item__avatar";
    img.src = channel.thumbnailUrl || "";
    img.alt = "";

    const nameLink = document.createElement("a");
    nameLink.className = "channel-item__name channel-item__name-link";
    nameLink.href = toYouTubeUrl(channel.urlPath || "/feed/subscriptions");
    nameLink.textContent = channel.title;
    nameLink.addEventListener("click", (event) => {
      event.preventDefault();
      void openInActiveTab(nameLink.href);
    });

    const watchLink = document.createElement("a");
    watchLink.className = "channel-item__live-link";
    watchLink.href = channel.liveVideoId
      ? toYouTubeUrl(`/watch?v=${channel.liveVideoId}`)
      : toYouTubeUrl(channel.urlPath || "/feed/subscriptions");
    watchLink.textContent = "Watch live";
    watchLink.addEventListener("click", (event) => {
      event.preventDefault();
      void openInActiveTab(watchLink.href);
    });

    li.appendChild(img);
    li.appendChild(nameLink);
    li.appendChild(watchLink);
    liveList.appendChild(li);
  }
}

async function scanFromYouTube() {
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";

  try {
    const scraped = await scrapeSubscriptionsFromChannelsPage();

    if (!scraped.length) {
      setScanHint(
        "No channels found. Open https://www.youtube.com/feed/channels, scroll to the bottom, then scan again.",
        true
      );
      return;
    }

    const existing = await getChannelList();
    const scrapedSanitized = sanitizeChannels(scraped);

    // Non-destructive scan: add/update from scraped channels, never auto-remove.
    const mergedByPath = new Map(existing.map((c) => [normalizeChannelPath(c.urlPath), c]));
    let added = 0;

    for (const channel of scrapedSanitized) {
      const key = normalizeChannelPath(channel.urlPath);
      const prev = mergedByPath.get(key);
      if (!prev) {
        added += 1;
      }

      mergedByPath.set(key, {
        ...channel,
        thumbnailUrl: channel.thumbnailUrl || prev?.thumbnailUrl || "",
        excludeFromLive: Boolean(prev?.excludeFromLive)
      });
    }

    const merged = Array.from(mergedByPath.values());

    await saveChannelList(merged);
    renderAllChannels(merged);
    refreshLiveIfVisible(true);

    setScanHint(
      `Scan complete. ${added} added.`,
      false
    );
  } catch (error) {
    setScanHint(`Scan failed: ${error.message}`, true);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "Scan from YouTube";
  }
}

async function scrapeSubscriptionsFromChannelsPage() {
  const [activeTab] = await tabsQuery({ active: true, currentWindow: true });

  if (activeTab?.id && isYouTubeChannelsPage(activeTab.url || "")) {
    return sendScrapeMessage(activeTab.id);
  }

  const tempTab = await tabsCreate({
    url: "https://www.youtube.com/feed/channels",
    active: false
  });

  try {
    await waitForTabComplete(tempTab.id);
    return await sendScrapeMessage(tempTab.id);
  } finally {
    if (tempTab?.id) {
      try {
        await tabsRemove(tempTab.id);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}

function sendScrapeMessage(tabId) {
  return tabsSendMessage(tabId, { type: "SCRAPE_SUBSCRIPTIONS" }).then((result) => result || []);
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for the subscriptions page to load."));
    }, 10000);

    const finish = () => {
      window.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) {
        return;
      }

      if (changeInfo.status === "complete") {
        finish();
      }
    };

    tabsGet(tabId).then((tab) => {
      if (tab?.status === "complete") {
        window.clearTimeout(timeoutId);
        resolve();
        return;
      }

      chrome.tabs.onUpdated.addListener(listener);
    }).catch((error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function isYouTubeChannelsPage(url) {
  try {
    return new URL(url).pathname === "/feed/channels";
  } catch {
    return false;
  }
}

function renderAllChannels(channels) {
  channelList.textContent = "";
  const sorted = channels.slice().sort((a, b) => a.title.localeCompare(b.title));

  channelCount.textContent = channels.length
    ? `${channels.length} channel${channels.length === 1 ? "" : "s"}`
    : "";

  if (!channels.length) {
    scanHint.hidden = false;
    return;
  }

  scanHint.hidden = true;

  for (const channel of sorted) {
    const li = document.createElement("li");
    li.className = "channel-item channel-item--all";

    const img = document.createElement("img");
    img.className = "channel-item__avatar";
    img.src = channel.thumbnailUrl || "";
    img.alt = "";

    const name = document.createElement("span");
    name.className = "channel-item__name";
    name.textContent = channel.title;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "channel-item__toggle";
    toggleBtn.textContent = channel.excludeFromLive ? "Excluded" : "Included";
    toggleBtn.title = channel.excludeFromLive
      ? "Click to include this channel in the Live Subscriptions list"
      : "Click to exclude this channel from the Live Subscriptions list";

    toggleBtn.addEventListener("click", async () => {
      const current = await getChannelList();
      const updated = current.map((c) => {
        if (normalizeChannelPath(c.urlPath) !== normalizeChannelPath(channel.urlPath)) {
          return c;
        }
        return { ...c, excludeFromLive: !Boolean(c.excludeFromLive) };
      });

      await saveChannelList(updated);
      renderAllChannels(updated);
      refreshLiveIfVisible(true);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "channel-item__remove";
    removeBtn.textContent = "X";
    removeBtn.title = "Remove this channel from your saved list";
    removeBtn.addEventListener("click", async () => {
      const current = await getChannelList();
      const updated = current.filter(
        (c) => normalizeChannelPath(c.urlPath) !== normalizeChannelPath(channel.urlPath)
      );

      await saveChannelList(updated);
      renderAllChannels(updated);
      refreshLiveIfVisible(true);
    });

    li.appendChild(img);
    li.appendChild(name);
    li.appendChild(toggleBtn);
    li.appendChild(removeBtn);
    channelList.appendChild(li);
  }
}

function setScanHint(text, isError) {
  scanHint.hidden = false;
  scanHint.textContent = text;
  scanHint.classList.toggle("note--error", isError);
}

function setLiveHint(text, isError) {
  liveHint.hidden = false;
  liveHint.textContent = text;
  liveHint.classList.toggle("note--error", isError);
}

function refreshLiveIfVisible(forceRefresh) {
  if (!panelLive.classList.contains("tab-panel--hidden")) {
    void refreshLiveList(forceRefresh);
  }
}

function fetchLiveChannels(forceRefresh) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GET_LIVE_CHANNELS", forceRefresh },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Unknown extension error."));
          return;
        }

        resolve(response.liveChannels || []);
      }
    );
  });
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function getChannelList() {
  const result = await storageGet([CHANNEL_LIST_KEY]);
  return sanitizeChannels(result[CHANNEL_LIST_KEY] || []);
}

async function saveChannelList(channels) {
  await storageSet({ [CHANNEL_LIST_KEY]: sanitizeChannels(channels) });
}

function sanitizeChannels(channels) {
  const byPath = new Map();

  for (const channel of channels || []) {
    const normalizedPath = normalizeChannelPath(channel?.urlPath || "");
    if (!normalizedPath || EXCLUDED_CHANNEL_PATHS.has(normalizedPath)) {
      continue;
    }

    if (byPath.has(normalizedPath)) {
      continue;
    }

    byPath.set(normalizedPath, {
      urlPath: normalizedPath,
      title: getDisplayTitle(channel?.title, normalizedPath),
      thumbnailUrl: channel?.thumbnailUrl || "",
      excludeFromLive: Boolean(channel?.excludeFromLive)
    });
  }

  return Array.from(byPath.values());
}

function normalizeChannelPath(path) {
  let normalized = (path || "").trim();
  if (!normalized) {
    return "";
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.split("?")[0].split("#")[0].replace(/\/+$/, "");

  if (/^\/@/i.test(normalized)) {
    return `/@${normalized.slice(2).toLowerCase()}`;
  }

  const channelMatch = normalized.match(/^\/channel\/([^/]+)/i);
  if (channelMatch) {
    return `/channel/${channelMatch[1]}`;
  }

  return normalized;
}

function toYouTubeUrl(path) {
  return new URL(path, "https://www.youtube.com").toString();
}

async function openInActiveTab(url) {
  const [activeTab] = await tabsQuery({ active: true, currentWindow: true });

  if (activeTab?.id) {
    await tabsUpdate(activeTab.id, { url });
    window.close();
    return;
  }

  await tabsCreate({ url });
  window.close();
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function tabsCreate(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tab || null);
    });
  });
}

function tabsRemove(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tab || null);
    });
  });
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tab || null);
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result);
    });
  });
}

function getDisplayTitle(rawTitle, normalizedPath) {
  const title = (rawTitle || "").trim();
  if (title) {
    return title.replace(/^\/@/, "@").replace(/^\//, "");
  }

  if (/^\/@/i.test(normalizedPath)) {
    return `@${normalizedPath.slice(2)}`;
  }

  return normalizedPath.replace(/^\//, "");
}
