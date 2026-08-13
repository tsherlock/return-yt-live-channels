const CHANNEL_LIST_KEY = "channelListV1";
const CHANNEL_STATS_KEY = "channelStatsV1";
const USER_BOOST_WEIGHT = 25;

const includedRows = document.getElementById("includedRows");
const excludedRows = document.getElementById("excludedRows");
const summary = document.getElementById("summary");
const status = document.getElementById("status");

let channels = [];
let statsByPath = {};
let orderedChannels = [];
let draggedPath = "";

void initialize();

async function initialize() {
  try {
    const data = await storageGet([CHANNEL_LIST_KEY, CHANNEL_STATS_KEY]);
    channels = sanitizeChannels(data[CHANNEL_LIST_KEY] || []);
    statsByPath = sanitizeChannelStats(data[CHANNEL_STATS_KEY] || {});
    orderedChannels = buildOrderedChannels(channels, statsByPath);
    applyRankBasedBoosts(orderedChannels, statsByPath);
    await saveStats(statsByPath);

    render();
    setStatus("", false);
  } catch (error) {
    setStatus(`Could not load settings: ${error.message}`, true);
  }
}

function render() {
  includedRows.textContent = "";
  excludedRows.textContent = "";

  const includedChannels = orderedChannels.filter((channel) => !channel.excludeFromLive);
  const excludedChannels = orderedChannels.filter((channel) => channel.excludeFromLive);
  summary.textContent = `${orderedChannels.length} total channels, ${includedChannels.length} included, ${excludedChannels.length} excluded.`;

  for (const [index, channel] of includedChannels.entries()) {
    const tr = document.createElement("tr");
    tr.className = "channel-row";
    tr.draggable = true;
    tr.dataset.path = normalizeChannelPath(channel.urlPath);
    tr.classList.toggle("channel-row--excluded", Boolean(channel.excludeFromLive));

    tr.addEventListener("dragstart", (event) => {
      draggedPath = normalizeChannelPath(channel.urlPath);
      tr.classList.add("channel-row--dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedPath);
      }
    });

    tr.addEventListener("dragend", () => {
      draggedPath = "";
      tr.classList.remove("channel-row--dragging");
      clearDropTargets();
    });

    tr.addEventListener("dragover", (event) => {
      event.preventDefault();
      tr.classList.add("channel-row--drop-target");
    });

    tr.addEventListener("dragleave", () => {
      tr.classList.remove("channel-row--drop-target");
    });

    tr.addEventListener("drop", (event) => {
      event.preventDefault();
      tr.classList.remove("channel-row--drop-target");
      const dropPath = normalizeChannelPath(channel.urlPath);
      void reorderChannels(draggedPath, dropPath);
    });

    const priorityTd = document.createElement("td");
    const priorityCell = document.createElement("div");
    priorityCell.className = "priority-cell";

    const rank = document.createElement("span");
    rank.className = "priority-rank";
    rank.textContent = `#${index + 1}`;

    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    dragHandle.textContent = "::";

    const impact = document.createElement("span");
    impact.className = "priority-impact";
    impact.textContent = `+${Math.round(getUserBoost(channel.urlPath) * USER_BOOST_WEIGHT)} score`;

    priorityCell.appendChild(rank);
    priorityCell.appendChild(dragHandle);
    priorityCell.appendChild(impact);
    priorityTd.appendChild(priorityCell);

    const channelTd = document.createElement("td");
    const channelCell = document.createElement("div");
    channelCell.className = "channel-cell";

    const avatar = document.createElement("img");
    avatar.className = "channel-avatar";
    avatar.src = channel.thumbnailUrl || "";
    avatar.alt = "";

    const textWrap = document.createElement("div");
    const name = document.createElement("p");
    name.className = "channel-name";
    name.textContent = channel.title;

    const meta = document.createElement("p");
    meta.className = "channel-meta";
    meta.textContent = channel.urlPath;

    textWrap.appendChild(name);
    textWrap.appendChild(meta);
    channelCell.appendChild(avatar);
    channelCell.appendChild(textWrap);
    channelTd.appendChild(channelCell);

    const includeTd = document.createElement("td");
    const toggleButton = document.createElement("button");
    toggleButton.className = "toggle-btn";
    toggleButton.type = "button";
    toggleButton.textContent = "Exclude";

    toggleButton.addEventListener("click", async () => {
      await setChannelExcluded(channel.urlPath, true);
    });

    includeTd.appendChild(toggleButton);

    tr.appendChild(priorityTd);
    tr.appendChild(channelTd);
    tr.appendChild(includeTd);
    includedRows.appendChild(tr);
  }

  if (!includedChannels.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.className = "empty-cell";
    emptyCell.colSpan = 3;
    emptyCell.textContent = "No included channels yet.";
    emptyRow.appendChild(emptyCell);
    includedRows.appendChild(emptyRow);
  }

  for (const channel of excludedChannels) {
    const tr = document.createElement("tr");
    tr.className = "channel-row channel-row--excluded";

    const channelTd = document.createElement("td");
    const channelCell = document.createElement("div");
    channelCell.className = "channel-cell";

    const avatar = document.createElement("img");
    avatar.className = "channel-avatar";
    avatar.src = channel.thumbnailUrl || "";
    avatar.alt = "";

    const textWrap = document.createElement("div");
    const name = document.createElement("p");
    name.className = "channel-name";
    name.textContent = channel.title;

    const meta = document.createElement("p");
    meta.className = "channel-meta";
    meta.textContent = channel.urlPath;

    textWrap.appendChild(name);
    textWrap.appendChild(meta);
    channelCell.appendChild(avatar);
    channelCell.appendChild(textWrap);
    channelTd.appendChild(channelCell);

    const includeTd = document.createElement("td");
    const toggleButton = document.createElement("button");
    toggleButton.className = "toggle-btn toggle-btn--exclude";
    toggleButton.type = "button";
    toggleButton.textContent = "Include";
    toggleButton.addEventListener("click", async () => {
      await setChannelExcluded(channel.urlPath, false);
    });

    includeTd.appendChild(toggleButton);
    tr.appendChild(channelTd);
    tr.appendChild(includeTd);
    excludedRows.appendChild(tr);
  }

  if (!excludedChannels.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.className = "empty-cell";
    emptyCell.colSpan = 2;
    emptyCell.textContent = "No excluded channels.";
    emptyRow.appendChild(emptyCell);
    excludedRows.appendChild(emptyRow);
  }
}

async function reorderChannels(dragPath, dropPath) {
  const fromPath = normalizeChannelPath(dragPath);
  const toPath = normalizeChannelPath(dropPath);
  if (!fromPath || !toPath || fromPath === toPath) {
    return;
  }

  const fromIndex = orderedChannels.findIndex(
    (channel) => normalizeChannelPath(channel.urlPath) === fromPath
  );
  const toIndex = orderedChannels.findIndex(
    (channel) => normalizeChannelPath(channel.urlPath) === toPath
  );

  if (fromIndex < 0 || toIndex < 0) {
    return;
  }

  const nextOrdered = orderedChannels.slice();
  const [moved] = nextOrdered.splice(fromIndex, 1);
  nextOrdered.splice(toIndex, 0, moved);

  try {
    orderedChannels = nextOrdered;
    channels = nextOrdered.slice();
    applyRankBasedBoosts(orderedChannels, statsByPath);
    await saveStats(statsByPath);
    render();
    setStatus("Saved priority order.", false);
  } catch (error) {
    setStatus(`Failed to save priority order: ${error.message}`, true);
  }
}

function clearDropTargets() {
  for (const row of includedRows.querySelectorAll(".channel-row--drop-target")) {
    row.classList.remove("channel-row--drop-target");
  }
}

async function setChannelExcluded(channelPath, excludeFromLive) {
  try {
    const normalizedTargetPath = normalizeChannelPath(channelPath);
    const nextChannels = orderedChannels.map((entry) => {
      if (normalizeChannelPath(entry.urlPath) !== normalizedTargetPath) {
        return entry;
      }

      return {
        ...entry,
        excludeFromLive: Boolean(excludeFromLive)
      };
    });

    orderedChannels = nextChannels;
    channels = nextChannels;
    applyRankBasedBoosts(orderedChannels, statsByPath);
    await Promise.all([
      saveChannels(nextChannels),
      saveStats(statsByPath)
    ]);
    render();
    setStatus("Saved channel include/exclude setting.", false);
  } catch (error) {
    setStatus(`Failed to update channel: ${error.message}`, true);
  }
}

function getUserBoost(path) {
  const normalizedPath = normalizeChannelPath(path);
  return clampNumber(Number(statsByPath[normalizedPath]?.userBoost) || 0, 0, 10);
}

function setUserBoost(path, value) {
  const normalizedPath = normalizeChannelPath(path);
  if (!normalizedPath) {
    return;
  }

  const previous = statsByPath[normalizedPath] || {
    lastCheckedAt: 0,
    lastLiveAt: 0,
    userBoost: 0,
    lastLiveVideoId: "",
    distinctLiveCount: 0,
    seenLiveVideoIds: []
  };

  statsByPath[normalizedPath] = {
    ...previous,
    userBoost: clampNumber(Number(value) || 0, 0, 10)
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function buildOrderedChannels(channelList, channelStats) {
  return channelList
    .slice()
    .sort((left, right) => {
      const leftBoost = clampNumber(Number(channelStats[normalizeChannelPath(left.urlPath)]?.userBoost) || 0, 0, 10);
      const rightBoost = clampNumber(Number(channelStats[normalizeChannelPath(right.urlPath)]?.userBoost) || 0, 0, 10);

      if (rightBoost !== leftBoost) {
        return rightBoost - leftBoost;
      }

      return left.title.localeCompare(right.title);
    });
}

function applyRankBasedBoosts(channelOrder, channelStats) {
  const includedChannels = channelOrder.filter((channel) => !channel.excludeFromLive);
  const excludedChannels = channelOrder.filter((channel) => channel.excludeFromLive);
  const total = Math.max(1, includedChannels.length);

  for (const [index, channel] of includedChannels.entries()) {
    const boost = clampNumber(Number((((total - index) / total) * 10).toFixed(4)), 0, 10);
    setUserBoost(channel.urlPath, boost);
  }

  for (const channel of excludedChannels) {
    setUserBoost(channel.urlPath, 0);
  }
}

async function saveChannels(nextChannels) {
  await storageSet({
    [CHANNEL_LIST_KEY]: sanitizeChannels(nextChannels)
  });
}

async function saveStats(nextStats) {
  await storageSet({
    [CHANNEL_STATS_KEY]: sanitizeChannelStats(nextStats)
  });
}

function setStatus(text, isError) {
  if (!text) {
    status.hidden = true;
    status.textContent = "";
    status.classList.remove("status--error");
    return;
  }

  status.hidden = false;
  status.textContent = text;
  status.classList.toggle("status--error", isError);
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

function sanitizeChannelStats(rawStats) {
  const stats = {};

  if (!rawStats || typeof rawStats !== "object") {
    return stats;
  }

  for (const [path, value] of Object.entries(rawStats)) {
    const normalizedPath = normalizeChannelPath(path);
    if (!normalizedPath) {
      continue;
    }

    const item = value && typeof value === "object" ? value : {};

    stats[normalizedPath] = {
      lastCheckedAt: Number(item.lastCheckedAt) || 0,
      lastLiveAt: Number(item.lastLiveAt) || 0,
      userBoost: clampNumber(Number(item.userBoost) || 0, 0, 10),
      lastLiveVideoId: typeof item.lastLiveVideoId === "string" ? item.lastLiveVideoId : "",
      distinctLiveCount: Number(item.distinctLiveCount) || 0,
      seenLiveVideoIds: Array.isArray(item.seenLiveVideoIds)
        ? item.seenLiveVideoIds.filter((entry) => typeof entry === "string" && entry.trim())
        : []
    };
  }

  return stats;
}

function sanitizeChannels(list) {
  const byPath = new Map();

  for (const channel of list || []) {
    const normalizedPath = normalizeChannelPath(channel?.urlPath || "");
    if (!normalizedPath || byPath.has(normalizedPath)) {
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
