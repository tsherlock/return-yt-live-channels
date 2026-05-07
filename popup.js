const CHANNEL_LIST_KEY = "channelListV1";
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes("youtube.com")) {
      setScanHint("Please open YouTube first, then click Scan.", true);
      return;
    }

    const scraped = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_SUBSCRIPTIONS" }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result || []);
        }
      });
    });

    if (!scraped.length) {
      setScanHint(
        "No channels found. Make sure the Subscriptions section in the YouTube sidebar is expanded.",
        true
      );
      return;
    }

    const existing = await getChannelList();
    const existingByPath = new Map(existing.map((c) => [normalizeChannelPath(c.urlPath), c]));
    const scrapedSanitized = sanitizeChannels(scraped);

    // Non-destructive scan: add/update from scraped channels, never auto-remove.
    const mergedByPath = new Map(existing.map((c) => [normalizeChannelPath(c.urlPath), c]));
    let added = 0;

    for (const channel of scrapedSanitized) {
      const key = normalizeChannelPath(channel.urlPath);
      const prev = existingByPath.get(key);
      if (!prev) {
        added += 1;
      }

      mergedByPath.set(key, {
        ...channel,
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
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (activeTab?.id) {
    await chrome.tabs.update(activeTab.id, { url });
    window.close();
    return;
  }

  await chrome.tabs.create({ url });
  window.close();
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
