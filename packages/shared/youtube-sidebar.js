const PANEL_ID = "yt-live-subscriptions-panel";
const DEFAULT_VISIBLE_CHANNELS = 8;
const AUTO_REFRESH_MS = 30 * 1000;
const MOUNT_RETRY_DELAYS_MS = [0, 150, 350, 700, 1200, 2000, 3200, 5000];

let allLiveChannels = [];
let showAllChannels = false;
let autoRefreshTimer = null;
let sidebarObserver = null;
let guideObserver = null;
let guideObserverTarget = null;
let mountRunId = 0;

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
  loadPanelData({ forceRefresh: false });
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

  const seeAllButton = document.createElement("button");
  seeAllButton.className = "yt-live-panel__see-all";
  seeAllButton.type = "button";
  seeAllButton.hidden = true;
  seeAllButton.textContent = "See All";

  panel.appendChild(header);
  panel.appendChild(statusEl);
  panel.appendChild(listEl);
  panel.appendChild(seeAllButton);

  seeAllButton.addEventListener("click", () => {
    showAllChannels = !showAllChannels;
    renderChannels(allLiveChannels);
  });

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
    list: panel.querySelector(".yt-live-panel__list"),
    seeAll: panel.querySelector(".yt-live-panel__see-all")
  };
}

function sortChannels(channels) {
  const sorted = channels.slice();

  sorted.sort((a, b) => a.title.localeCompare(b.title));

  return sorted;
}

function updateSeeAllButton(totalChannels) {
  const nodes = getPanelNodes();
  if (!nodes) {
    return;
  }

  const shouldShow = totalChannels > DEFAULT_VISIBLE_CHANNELS;
  nodes.seeAll.hidden = !shouldShow;
  nodes.seeAll.textContent = showAllChannels ? "Show Less" : "See All";
}

function formatViewerCount(count) {
  if (!count) {
    return "Live now";
  }

  return `${new Intl.NumberFormat().format(count)} watching`;
}

function renderChannels(channels) {
  const nodes = getPanelNodes();
  if (!nodes) {
    return;
  }

  allLiveChannels = channels.slice();
  nodes.list.textContent = "";

  const sortedChannels = sortChannels(channels);
  const visibleChannels = showAllChannels
    ? sortedChannels
    : sortedChannels.slice(0, DEFAULT_VISIBLE_CHANNELS);

  for (const channel of visibleChannels) {
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
    watchLink.textContent = formatViewerCount(channel.viewerCount);

    meta.appendChild(nameLink);
    meta.appendChild(watchLink);
    item.appendChild(img);
    item.appendChild(meta);
    nodes.list.appendChild(item);
  }

  updateSeeAllButton(sortedChannels.length);
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

      resolve(response.liveChannels || []);
      }
    );
  });
}

async function loadPanelData({ forceRefresh }) {
  const nodes = getPanelNodes();
  if (!nodes) {
    return;
  }

  const isFirstLoad = !nodes.list.children.length;
  if (isFirstLoad) {
    setStatus("Loading live channels...");
  }

  try {
    const channels = await fetchLiveChannels(forceRefresh);

    if (!channels.length) {
      allLiveChannels = [];
      showAllChannels = false;
      renderChannels([]);
      setStatus("None of your subscriptions are live right now.");
      return;
    }

    allLiveChannels = channels;
    renderChannels(channels);
    setStatus("");
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
    if (document.hidden) {
      return;
    }

    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.isConnected) {
      loadPanelData({ forceRefresh: true });
    } else {
      queueEnsurePanelMounted("auto-refresh-mount");
    }
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
  startAutoRefresh();
})();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_SUBSCRIPTIONS") {
    return false;
  }

  const channels = scrapeSubscriptionsFromGuide();
  sendResponse(channels);
  return false;
});

function scrapeSubscriptionsFromGuide() {
  // First, try to scrape by guide sections (more targeted)
  const channels = scrapeFromSections();
  if (channels.length > 0) {
    return channels;
  }

  // Fallback: scrape all entries in guide, but avoid Explore section items
  return scrapeAllEntries();
}

function scrapeFromSections() {
  const sections = Array.from(
    document.querySelectorAll("ytd-guide-renderer ytd-guide-section-renderer")
  );

  const channels = [];

  for (const section of sections) {
    // Check if this section's header contains "Explore"
    const header = section.querySelector("ytd-guide-section-header-renderer");
    const headerText = (header?.textContent || "").trim().toLowerCase();

    if (headerText.includes("explore")) {
      // Stop scraping — don't include Explore or anything after
      break;
    }

    const entries = section.querySelectorAll("ytd-guide-entry-renderer");
    scrapeEntriesInto(entries, channels);
  }

  return channels;
}

function scrapeAllEntries() {
  const entries = document.querySelectorAll(
    "ytd-guide-renderer ytd-guide-entry-renderer"
  );
  const channels = [];
  scrapeEntriesInto(entries, channels);
  return channels;
}

function scrapeEntriesInto(entries, channels) {
  for (const entry of entries) {
    const link = entry.querySelector("a#endpoint");
    if (!link) {
      continue;
    }

    const href = link.getAttribute("href") || "";
    const normalizedHref = normalizeChannelPath(href);

    if (!normalizedHref.startsWith("/@") && !/^\/channel\/UC/i.test(normalizedHref)) {
      continue;
    }

    // Deduplicate by urlPath
    if (channels.some((c) => c.urlPath === normalizedHref)) {
      continue;
    }

    const img = entry.querySelector("img");
    const imgShadow = entry.querySelector("yt-img-shadow");
    const titleEl = entry.querySelector("#title, yt-formatted-string#title");
    const title = titleEl?.textContent?.trim() || href;

    // img.src may be empty for lazy-loaded off-screen avatars;
    // fall back to yt-img-shadow[data-thumb] if available.
    const thumbnailUrl =
      (img?.src && img.src.startsWith("http") ? img.src : "") ||
      imgShadow?.getAttribute("data-thumb") ||
      img?.getAttribute("data-thumb") ||
      "";

    channels.push({
      urlPath: normalizedHref,
      title,
      thumbnailUrl
    });
  }
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
