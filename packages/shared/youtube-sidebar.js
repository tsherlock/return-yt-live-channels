const PANEL_ID = "yt-live-subscriptions-panel";
const AUTO_REFRESH_MS = 30 * 1000;
const MOUNT_RETRY_DELAYS_MS = [0, 150, 350, 700, 1200, 2000, 3200, 5000];
const LIVE_CACHE_KEY = "liveChannelsCacheV3";

let allLiveChannels = [];
let autoRefreshTimer = null;
let sidebarObserver = null;
let guideObserver = null;
let guideObserverTarget = null;
let mountRunId = 0;
let lastScanStatus = null;

function removePanelContainer() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }

  const wrapper = panel.closest(".yt-live-panel__section");
  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.removeChild(wrapper);
    return;
  }

  if (panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
}

function isPanelHealthy(panel) {
  if (!panel || !panel.isConnected) {
    return false;
  }

  if (!panel.closest("ytd-guide-renderer")) {
    return false;
  }

  // Parent containers can be replaced during SPA navigation; keep existing
  // connected panels instead of forcing remount churn.
  return true;
}

function safeInsertPanel(wrapper, insertionPoint) {
  const parent = insertionPoint?.parent;
  if (!parent || !parent.isConnected) {
    return false;
  }

  const beforeNode = insertionPoint.beforeNode;
  if (beforeNode && beforeNode.parentNode === parent) {
    parent.insertBefore(wrapper, beforeNode);
    return true;
  }

  // Fallback when YouTube mutates DOM between lookup and insertion.
  // Recompute the anchor once before falling back to append.
  const refreshedInsertionPoint = findInsertionPoint();
  const refreshedParent = refreshedInsertionPoint?.parent;
  const refreshedBeforeNode = refreshedInsertionPoint?.beforeNode;

  if (
    refreshedParent &&
    refreshedParent.isConnected &&
    refreshedBeforeNode &&
    refreshedBeforeNode.parentNode === refreshedParent
  ) {
    refreshedParent.insertBefore(wrapper, refreshedBeforeNode);
    return true;
  }

  parent.appendChild(wrapper);
  return true;
}

function ensurePanelMounted(source = "unknown") {
  const existingPanel = document.getElementById(PANEL_ID);
  if (existingPanel && !existingPanel.closest("ytd-guide-renderer")) {
    removePanelContainer();
  }

  const insertionPoint = findInsertionPoint();
  if (!insertionPoint) {
    return;
  }

  const currentPanel = document.getElementById(PANEL_ID);
  if (currentPanel && isPanelHealthy(currentPanel)) {
    return;
  }

  if (currentPanel) {
    removePanelContainer();
  }

  const panel = buildPanel();
  const inserted = safeInsertPanel(panel, insertionPoint);
  if (!inserted) {
    return;
  }

  renderChannels(allLiveChannels);
  if (allLiveChannels.length) {
    if (lastScanStatus?.warmingUp) {
      setStatus(
        `Warming up: checked ${lastScanStatus.checkedRecently}/${lastScanStatus.totalChannels} channels this sweep.`
      );
    } else {
      setStatus("");
    }
  } else if (lastScanStatus?.warmingUp) {
    setStatus(
      `Warming up: checked ${lastScanStatus.checkedRecently}/${lastScanStatus.totalChannels} channels this sweep. Scanning continues in the background.`
    );
  } else {
    setStatus("No recently cached live channels yet. Scanning continues in the background.");
  }
}

function findInsertionPoint() {
  const subscriptionsLink = document.querySelector(
    "ytd-guide-renderer a#endpoint[href='/feed/subscriptions'], ytd-guide-renderer a#endpoint[href*='/feed/subscriptions']"
  );

  if (subscriptionsLink) {
    const subscriptionEntry = subscriptionsLink.closest(
      "ytd-guide-entry-renderer"
    );
    const subscriptionSection = subscriptionsLink.closest("ytd-guide-section-renderer");

    if (subscriptionSection && subscriptionSection.parentElement) {
      return {
        parent: subscriptionSection.parentElement,
        // Insert above the Subscriptions section.
        beforeNode: subscriptionSection
      };
    }

    if (subscriptionEntry && subscriptionEntry.parentElement) {
      return {
        parent: subscriptionEntry.parentElement,
        // Insert above the Subscriptions entry when section wrapper isn't available.
        beforeNode: subscriptionEntry
      };
    }
  }

  const firstGuideSection = document.querySelector(
    "ytd-guide-renderer ytd-guide-section-renderer"
  );

  if (firstGuideSection && firstGuideSection.parentElement) {
    return {
      parent: firstGuideSection.parentElement,
      beforeNode: firstGuideSection
    };
  }

  return null;
}

function buildPanel() {
  const wrapper = document.createElement("div");
  wrapper.className = "yt-live-panel__section";

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "yt-live-panel";
  wrapper.appendChild(panel);

  const header = document.createElement("div");
  header.className = "yt-live-panel__header";
  const titleEl = document.createElement("h3");
  titleEl.className = "yt-live-panel__title";
  titleEl.textContent = "Live Subscriptions";
  header.appendChild(titleEl);

  const statusEl = document.createElement("p");
  statusEl.className = "yt-live-panel__status";
  statusEl.textContent = "Loading...";

  const listEl = document.createElement("ul");
  listEl.className = "yt-live-panel__list";

  panel.appendChild(header);
  panel.appendChild(statusEl);
  panel.appendChild(listEl);

  return wrapper;
}

function getPanelNodes() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return null;
  }

  return {
    panel,
    status: panel.querySelector(".yt-live-panel__status"),
    list: panel.querySelector(".yt-live-panel__list")
  };
}

function sortChannels(channels) {
  const sorted = channels.slice();

  sorted.sort((a, b) => a.title.localeCompare(b.title));

  return sorted;
}

function renderChannels(channels) {
  const nodes = getPanelNodes();
  if (!nodes) {
    return;
  }

  allLiveChannels = channels.slice();
  nodes.list.textContent = "";

  const sortedChannels = sortChannels(channels);

  for (const channel of sortedChannels) {
    const item = document.createElement("li");
    item.className = "yt-live-panel__item";

    const img = document.createElement("img");
    img.className = "yt-live-panel__avatar";
    img.src = channel.thumbnailUrl || "";
    img.alt = "";
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "yt-live-panel__meta";

    const nameLink = document.createElement("a");
    nameLink.className = "yt-live-panel__name";
    nameLink.href = channel.urlPath || "/feed/subscriptions";
    nameLink.textContent = channel.title;

    const watchLink = document.createElement("a");
    watchLink.className = "yt-live-panel__watch";
    watchLink.href = channel.liveVideoId ? `/watch?v=${channel.liveVideoId}` : (channel.urlPath || "/feed/subscriptions");
    watchLink.textContent = "Watch live";

    meta.appendChild(nameLink);
    meta.appendChild(watchLink);
    item.appendChild(img);
    item.appendChild(meta);
    nodes.list.appendChild(item);
  }
}

function setStatus(text, isError = false) {
  const nodes = getPanelNodes();
  if (!nodes) {
    return;
  }

  nodes.status.textContent = text;
  nodes.status.hidden = !text;
  nodes.status.classList.toggle("yt-live-panel__status--error", isError);
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

      resolve({
        channels: response.liveChannels || [],
        scanStatus: response.scanStatus || null
      });
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

async function loadCachedLiveChannels() {
  try {
    const result = await storageGet([LIVE_CACHE_KEY]);
    const record = result[LIVE_CACHE_KEY];
    const items = Array.isArray(record?.items) ? record.items : [];

    allLiveChannels = items;

    const nodes = getPanelNodes();
    if (!nodes) {
      return;
    }

    renderChannels(items);
    if (items.length) {
      if (lastScanStatus?.warmingUp) {
        setStatus(
          `Warming up: checked ${lastScanStatus.checkedRecently}/${lastScanStatus.totalChannels} channels this sweep.`
        );
      } else {
        setStatus("");
      }
    } else if (lastScanStatus?.warmingUp) {
      setStatus(
        `Warming up: checked ${lastScanStatus.checkedRecently}/${lastScanStatus.totalChannels} channels this sweep. Scanning continues in the background.`
      );
    } else {
      setStatus("No recently cached live channels yet. Scanning continues in the background.");
    }
  } catch {
    // Ignore cache read failures and let live refresh path recover.
  }
}

async function loadPanelData({ forceRefresh }) {
  const nodes = getPanelNodes();
  const isFirstLoad = Boolean(nodes && !nodes.list.children.length);
  if (isFirstLoad) {
    if (allLiveChannels.length) {
      renderChannels(allLiveChannels);
      setStatus("Refreshing live channels...");
    } else {
      setStatus("Loading live channels...");
    }
  }

  try {
    const { channels, scanStatus } = await fetchLiveChannels(forceRefresh);
    lastScanStatus = scanStatus || null;

    allLiveChannels = channels;

    if (!nodes) {
      return;
    }

    if (!channels.length) {
      renderChannels([]);
      if (scanStatus?.warmingUp) {
        setStatus(
          `Warming up: checked ${scanStatus.checkedRecently}/${scanStatus.totalChannels} channels this sweep. Scanning continues in the background.`
        );
      } else {
        setStatus("No channels are live right now.");
      }
      return;
    }

    renderChannels(channels);
    if (scanStatus?.warmingUp) {
      setStatus(
        `Warming up: checked ${scanStatus.checkedRecently}/${scanStatus.totalChannels} channels this sweep.`
      );
    } else {
      setStatus("");
    }
  } catch (error) {
    setStatus(`Could not load live subscriptions: ${error.message}`, true);
  }
}

function disconnectSidebarObservers() {
  if (sidebarObserver) {
    sidebarObserver.disconnect();
    sidebarObserver = null;
  }

  if (guideObserver) {
    guideObserver.disconnect();
    guideObserver = null;
  }

  guideObserverTarget = null;
}

function watchForSidebar() {
  disconnectSidebarObservers();

  let debounceTimer = null;

  sidebarObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      queueEnsurePanelMounted("sidebar-observer");
    }, 200);
  });

  const bindToGuide = () => {
    const guide = document.querySelector("ytd-guide-renderer");
    if (!guide) {
      return false;
    }

    if (guideObserverTarget === guide) {
      return true;
    }

    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver.observe(guide, { childList: true, subtree: true });
    }

    guideObserverTarget = guide;
    return true;
  };

  if (bindToGuide()) {
    return;
  }

  guideObserver = new MutationObserver(() => {
    if (bindToGuide()) {
      guideObserver.disconnect();
      guideObserver = null;
      queueEnsurePanelMounted("guide-observer");
    }
  });

  if (document.body) {
    guideObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    return;
  }

  autoRefreshTimer = window.setInterval(() => {
    void loadPanelData({ forceRefresh: true });
  }, AUTO_REFRESH_MS);
}

function queueEnsurePanelMounted(source = "unknown") {
  mountRunId += 1;
  const currentRunId = mountRunId;

  MOUNT_RETRY_DELAYS_MS.forEach((delayMs, attempt) => {
    window.setTimeout(() => {
      if (currentRunId !== mountRunId) {
        return;
      }

      ensurePanelMounted(`${source}#${attempt}`);
    }, delayMs);
  });
}

window.addEventListener("yt-navigate-finish", () => {
  watchForSidebar();
  queueEnsurePanelMounted("yt-navigate-finish");
});

window.addEventListener("yt-page-data-updated", () => {
  watchForSidebar();
  queueEnsurePanelMounted("yt-page-data-updated");
});

(async function bootstrap() {
  queueEnsurePanelMounted("bootstrap");
  watchForSidebar();
  void loadCachedLiveChannels();
  startAutoRefresh();
  void loadPanelData({ forceRefresh: true });
})();
