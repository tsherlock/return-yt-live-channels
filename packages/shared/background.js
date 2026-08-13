const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const LIVE_CACHE_KEY = "liveChannelsCacheV3";
const CHANNEL_LIST_KEY = "channelListV1";
const CHANNEL_STATS_KEY = "channelStatsV1";
const REFRESH_CYCLE_TTL_MS = 30 * 1000;
const INITIAL_CHANNEL_CHECKS_PER_REFRESH = 8;
const MAX_CHANNEL_CHECKS_PER_REFRESH = 4;
const KNOWN_LIVE_CHECKS_PER_REFRESH = 1;
const KNOWN_LIVE_RECHECK_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_CHANNEL_CHECK_INTERVAL_MS = 5 * 1000;
const LIVE_ENTRY_STALE_MS = 45 * 60 * 1000;
const RECENT_LIVE_BOOST_WINDOW_MS = 6 * 60 * 60 * 1000;
const HISTORICAL_LIVE_BOOST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STARVATION_BOOST_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEBUG_LIVE_REFRESH = true;
const USER_BOOST_WEIGHT = 25;
const MAX_TRACKED_LIVE_VIDEO_IDS = 20;
const DISTINCT_LIVE_VIDEO_WEIGHT = 80;

// Utility: sleep with Promise
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugLog(message, extra) {
  if (!DEBUG_LIVE_REFRESH) {
    return;
  }

  if (typeof extra === "undefined") {
    console.log(`[live-refresh] ${message}`);
    return;
  }

  console.log(`[live-refresh] ${message}`, extra);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LIVE_CHANNELS") {
    return false;
  }

  loadLiveChannels({ forceRefresh: Boolean(message.forceRefresh) })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

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

async function getStoredRecord(key) {
  const result = await storageGet([key]);
  return result[key] || null;
}

async function getFreshCache(cacheKey, maxAgeMs) {
  const result = await storageGet([cacheKey]);
  const record = result[cacheKey];

  if (!record || !record.fetchedAt || !Array.isArray(record.items)) {
    return null;
  }

  const isFresh = Date.now() - record.fetchedAt <= maxAgeMs;
  return isFresh ? record : null;
}

async function saveCache(cacheKey, items) {
  await storageSet({
    [cacheKey]: { fetchedAt: Date.now(), items }
  });
}

async function getChannelList() {
  const result = await storageGet([CHANNEL_LIST_KEY]);
  return sanitizeChannels(result[CHANNEL_LIST_KEY] || []);
}

async function getChannelStats() {
  const rawStats = await getStoredRecord(CHANNEL_STATS_KEY);
  return sanitizeChannelStats(rawStats);
}

function sanitizeChannelStats(rawStats) {
  const statsByPath = {};

  if (!rawStats || typeof rawStats !== "object") {
    return statsByPath;
  }

  for (const [path, stats] of Object.entries(rawStats)) {
    const normalizedPath = normalizeChannelPath(path);
    if (!normalizedPath || !stats || typeof stats !== "object") {
      continue;
    }

    statsByPath[normalizedPath] = {
      lastCheckedAt: Number(stats.lastCheckedAt) || 0,
      lastLiveAt: Number(stats.lastLiveAt) || 0,
      userBoost: Number(stats.userBoost) || 0,
      lastLiveVideoId: typeof stats.lastLiveVideoId === "string" ? stats.lastLiveVideoId : "",
      distinctLiveCount: Number(stats.distinctLiveCount) || 0,
      seenLiveVideoIds: Array.isArray(stats.seenLiveVideoIds)
        ? stats.seenLiveVideoIds.filter((videoId) => typeof videoId === "string" && videoId.trim())
        : []
    };
  }

  return statsByPath;
}

function mergeLiveChannelsWithChannelList(liveChannels, channels) {
  const channelsByPath = new Map(
    channels.map((channel) => [normalizeChannelPath(channel.urlPath), channel])
  );

  return (liveChannels || []).map((liveChannel) => {
    const savedChannel = channelsByPath.get(normalizeChannelPath(liveChannel?.urlPath || ""));
    if (!savedChannel) {
      return liveChannel;
    }

    return {
      ...liveChannel,
      title: savedChannel.title || liveChannel.title,
      thumbnailUrl: savedChannel.thumbnailUrl || liveChannel.thumbnailUrl || "",
      excludeFromLive: Boolean(savedChannel.excludeFromLive)
    };
  });
}

function getCacheItems(record, channels, now = Date.now()) {
  const fallbackCheckedAt = Number(record?.fetchedAt) || 0;
  const hydratedItems = mergeLiveChannelsWithChannelList(record?.items || [], channels);

  return hydratedItems.filter((channel) => {
    if (channel.excludeFromLive) {
      return false;
    }

    const checkedAt = Number(channel.checkedAt) || fallbackCheckedAt;
    return checkedAt > 0 && now - checkedAt <= LIVE_ENTRY_STALE_MS;
  }).map((channel) => ({
    ...channel,
    checkedAt: Number(channel.checkedAt) || fallbackCheckedAt
  }));
}

function scoreChannelForRefresh(stats, isCurrentlyLive, now) {
  const lastCheckedAt = Number(stats?.lastCheckedAt) || 0;
  const lastLiveAt = Number(stats?.lastLiveAt) || 0;
  const userBoost = Number(stats?.userBoost) || 0;
  const distinctLiveCount = Number(stats?.distinctLiveCount) || 0;

  let score = 0;

  if (!lastCheckedAt) {
    score += 250;
  } else {
    const ageSinceCheck = now - lastCheckedAt;
    score += Math.min(ageSinceCheck / (30 * 60 * 1000), 96);

    if (ageSinceCheck >= STARVATION_BOOST_WINDOW_MS) {
      score += 120;
    }
  }

  if (lastLiveAt) {
    const ageSinceLive = now - lastLiveAt;
    if (ageSinceLive <= RECENT_LIVE_BOOST_WINDOW_MS) {
      score += 220;
    } else if (ageSinceLive <= 24 * 60 * 60 * 1000) {
      score += 140;
    } else if (ageSinceLive <= HISTORICAL_LIVE_BOOST_WINDOW_MS) {
      score += 60;
    } else {
      score += 20;
    }
  }

  if (distinctLiveCount > 0) {
    score += Math.min(distinctLiveCount * 4, DISTINCT_LIVE_VIDEO_WEIGHT);
  }

  if (isCurrentlyLive) {
    score += 180;
  }

  // Reserved for future manual prioritization controls.
  score += userBoost * USER_BOOST_WEIGHT;

  return score;
}

function buildScanStatus(channels, statsByPath, now = Date.now()) {
  const totalChannels = channels.length;
  if (!totalChannels) {
    return {
      totalChannels: 0,
      checkedRecently: 0,
      coverageRatio: 1,
      warmingUp: false,
      expectedSweepMs: 0
    };
  }

  const checksPerCycle = Math.max(1, MAX_CHANNEL_CHECKS_PER_REFRESH);
  const expectedSweepMs = Math.max(
    REFRESH_CYCLE_TTL_MS,
    Math.ceil(totalChannels / checksPerCycle) * REFRESH_CYCLE_TTL_MS
  );
  const cutoff = now - expectedSweepMs;

  let checkedRecently = 0;
  for (const channel of channels) {
    const normalizedPath = normalizeChannelPath(channel.urlPath);
    const lastCheckedAt = Number(statsByPath[normalizedPath]?.lastCheckedAt) || 0;
    if (lastCheckedAt >= cutoff) {
      checkedRecently += 1;
    }
  }

  const coverageRatio = checkedRecently / totalChannels;

  return {
    totalChannels,
    checkedRecently,
    coverageRatio,
    warmingUp: coverageRatio < 0.95,
    expectedSweepMs
  };
}

function selectChannelsForRefresh(channels, statsByPath, currentLiveMap, now) {
  const hasHistory = Object.keys(statsByPath).length > 0 || currentLiveMap.size > 0;
  const limit = hasHistory ? MAX_CHANNEL_CHECKS_PER_REFRESH : INITIAL_CHANNEL_CHECKS_PER_REFRESH;

  const rankedEntries = channels
    .map((channel, index) => {
      const normalizedPath = normalizeChannelPath(channel.urlPath);
      const stats = statsByPath[normalizedPath];
      const score = scoreChannelForRefresh(stats, currentLiveMap.has(normalizedPath), now);
      return {
        channel,
        normalizedPath,
        score,
        index,
        lastCheckedAt: Number(stats?.lastCheckedAt) || 0,
        isCurrentlyLive: currentLiveMap.has(normalizedPath)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.lastCheckedAt !== right.lastCheckedAt) {
        return left.lastCheckedAt - right.lastCheckedAt;
      }

      return left.index - right.index;
    });

  if (!hasHistory) {
    return rankedEntries
      .slice(0, Math.min(limit, channels.length))
      .map((entry) => entry.channel);
  }

  const selected = [];
  const selectedPaths = new Set();
  const knownLiveBudget = Math.min(KNOWN_LIVE_CHECKS_PER_REFRESH, limit);

  for (const entry of rankedEntries) {
    if (!entry.isCurrentlyLive) {
      continue;
    }

    const ageSinceCheck = entry.lastCheckedAt > 0 ? now - entry.lastCheckedAt : Number.POSITIVE_INFINITY;
    if (ageSinceCheck < KNOWN_LIVE_RECHECK_COOLDOWN_MS) {
      continue;
    }

    selected.push(entry.channel);
    selectedPaths.add(entry.normalizedPath);

    if (selected.length >= knownLiveBudget) {
      break;
    }
  }

  const exploratoryEntries = rankedEntries
    .filter((entry) => !selectedPaths.has(entry.normalizedPath))
    .sort((left, right) => {
      if (left.lastCheckedAt !== right.lastCheckedAt) {
        return left.lastCheckedAt - right.lastCheckedAt;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });

  for (const entry of exploratoryEntries) {
    selected.push(entry.channel);
    if (selected.length >= Math.min(limit, channels.length)) {
      break;
    }
  }

  return selected;
}

function updateChannelStats(statsByPath, channelPath, isLive, checkedAt, liveVideoId = "") {
  const normalizedPath = normalizeChannelPath(channelPath);
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
  const seenLiveVideoIds = Array.isArray(previous.seenLiveVideoIds) ? previous.seenLiveVideoIds.slice() : [];
  let distinctLiveCount = Number(previous.distinctLiveCount) || 0;

  if (isLive && liveVideoId) {
    const alreadySeen = seenLiveVideoIds.includes(liveVideoId);
    if (!alreadySeen) {
      seenLiveVideoIds.unshift(liveVideoId);
      distinctLiveCount += 1;
      if (seenLiveVideoIds.length > MAX_TRACKED_LIVE_VIDEO_IDS) {
        seenLiveVideoIds.length = MAX_TRACKED_LIVE_VIDEO_IDS;
      }
    }
  }

  statsByPath[normalizedPath] = {
    lastCheckedAt: checkedAt,
    lastLiveAt: isLive ? checkedAt : previous.lastLiveAt,
    lastLiveVideoId: isLive && liveVideoId ? liveVideoId : previous.lastLiveVideoId,
    userBoost: previous.userBoost,
    distinctLiveCount,
    seenLiveVideoIds
  };
}

function toCacheRecord(items) {
  return {
    fetchedAt: Date.now(),
    items
  };
}

async function checkChannelLive(channel) {
  try {
    const response = await fetch(`https://www.youtube.com${channel.urlPath}/live`, {
      redirect: "follow"
    });

    if (!response.ok) {
      return null;
    }

    const finalUrl = response.url;

    // If /live redirects to a watch URL, the channel is live.
    if (finalUrl.includes("/watch?v=")) {
      const liveVideoId = new URL(finalUrl).searchParams.get("v");
      if (liveVideoId && await isWatchPageLive(liveVideoId)) {
        return { ...channel, liveVideoId };
      }
    }

    // If /live does not redirect, require live markers and verify the candidate watch page.
    if (finalUrl.includes("/live")) {
      const html = await response.text();

      const hasLiveMarker =
        html.includes('"isLiveNow":true') ||
        html.includes("BADGE_STYLE_TYPE_LIVE_NOW") ||
        html.includes('"hlsManifestUrl":"');

      if (!hasLiveMarker) {
        return null;
      }

      const candidateVideoIds = extractCandidateVideoIds(html);
      for (const videoId of candidateVideoIds) {
        if (await isWatchPageLive(videoId)) {
          return { ...channel, liveVideoId: videoId };
        }
      }

      return null;
    }
    return null;

  } catch (error) {
    return null;
  }
}

function extractCandidateVideoIds(html) {
  const ids = new Set();

  const patterns = [
    new RegExp('"canonicalBaseUrl":"\\\\/watch\\\\?v=([a-zA-Z0-9_-]{11})"', "g"),
    new RegExp('"videoId":"([a-zA-Z0-9_-]{11})"', "g"),
    new RegExp('<link rel="canonical" href="https:\\/\\/www\\.youtube\\.com\\/watch\\?v=([a-zA-Z0-9_-]{11})"', "g")
  ];

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        ids.add(match[1]);
      }
    }
  }

  return Array.from(ids);
}

async function isWatchPageLive(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      redirect: "follow"
    });
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    const hasLiveNow = html.includes('"isLiveNow":true');
    const hasLiveNowBadge = html.includes("BADGE_STYLE_TYPE_LIVE_NOW");
    const hasHlsManifest = html.includes('"hlsManifestUrl":"');

    const isUpcoming =
      html.includes('"isUpcoming":true') ||
      html.includes('"upcomingEventData"');

    const isOffline =
      html.includes('"LIVE_STREAM_OFFLINE"') ||
      html.includes('"offlineSlate"');

    const isPostLive = html.includes('"isPostLiveDvr":true');

    const isActivelyLive = hasLiveNow || hasLiveNowBadge || hasHlsManifest;
    return isActivelyLive && !isUpcoming && !isOffline && !isPostLive;
  } catch {
    return false;
  }
}

async function loadLiveChannels({ forceRefresh = false } = {}) {
  const now = Date.now();
  const channels = (await getChannelList()).filter((channel) => !channel.excludeFromLive);
  const statsByPath = await getChannelStats();
  const cachedRecord = await getStoredRecord(LIVE_CACHE_KEY);
  const cachedItems = getCacheItems(cachedRecord, channels, now);

  if (!forceRefresh) {
    const liveCache = await getFreshCache(LIVE_CACHE_KEY, REFRESH_CYCLE_TTL_MS);
    if (liveCache) {
      const liveChannels = getCacheItems(liveCache, channels, now);
      const scanStatus = buildScanStatus(channels, statsByPath, now);
      debugLog("serving cached live results", {
        channelCount: channels.length,
        liveCount: liveChannels.length,
        checkedRecently: scanStatus.checkedRecently,
        fetchedAt: liveCache.fetchedAt
      });
      return { liveChannels, scanStatus };
    }
  }

  if (!channels.length) {
    await saveCache(LIVE_CACHE_KEY, []);
    await storageSet({ [CHANNEL_STATS_KEY]: {} });
    return { liveChannels: [], scanStatus: buildScanStatus([], {}, now) };
  }

  const liveByPath = new Map(
    cachedItems.map((channel) => [normalizeChannelPath(channel.urlPath), channel])
  );
  const channelsToCheck = selectChannelsForRefresh(channels, statsByPath, liveByPath, now);

  debugLog("starting refresh cycle", {
    forceRefresh,
    totalChannels: channels.length,
    cachedLiveCount: cachedItems.length,
    selectedCount: channelsToCheck.length,
    minChannelCheckIntervalMs: MIN_CHANNEL_CHECK_INTERVAL_MS,
    selectedChannels: channelsToCheck.map((channel) => channel.title || channel.urlPath)
  });

  for (const channel of channelsToCheck) {
    const startedAt = Date.now();
    debugLog("checking channel", {
      title: channel.title,
      urlPath: channel.urlPath
    });
    const result = await checkChannelLive(channel);
    const normalizedPath = normalizeChannelPath(channel.urlPath);
    const checkedAt = Date.now();

    if (result) {
      liveByPath.set(normalizedPath, {
        ...result,
        checkedAt
      });
      updateChannelStats(statsByPath, normalizedPath, true, checkedAt, result.liveVideoId || "");
      debugLog("channel is live", {
        title: channel.title,
        urlPath: channel.urlPath,
        liveVideoId: result.liveVideoId,
        checkedAt
      });
    } else {
      liveByPath.delete(normalizedPath);
      updateChannelStats(statsByPath, normalizedPath, false, checkedAt);
      debugLog("channel is not live", {
        title: channel.title,
        urlPath: channel.urlPath,
        checkedAt
      });
    }

    const elapsed = Date.now() - startedAt;
    const delayMs = Math.max(0, MIN_CHANNEL_CHECK_INTERVAL_MS - elapsed);
    debugLog("channel check finished", {
      title: channel.title,
      elapsedMs: elapsed,
      delayUntilNextMs: delayMs
    });
    if (delayMs > 0 && channel !== channelsToCheck[channelsToCheck.length - 1]) {
      await sleep(delayMs);
    }
  }

  const hydratedLiveChannels = mergeLiveChannelsWithChannelList(
    Array.from(liveByPath.values()),
    channels
  );

  const freshLiveChannels = hydratedLiveChannels.filter((channel) => {
    const checkedAt = Number(channel.checkedAt) || now;
    return checkedAt > 0 && now - checkedAt <= LIVE_ENTRY_STALE_MS;
  });

  await storageSet({
    [LIVE_CACHE_KEY]: toCacheRecord(freshLiveChannels),
    [CHANNEL_STATS_KEY]: statsByPath
  });

  const scanStatus = buildScanStatus(channels, statsByPath, now);

  debugLog("finished refresh cycle", {
    liveCount: freshLiveChannels.length,
    checkedCount: channelsToCheck.length,
    checkedRecently: scanStatus.checkedRecently,
    totalChannels: scanStatus.totalChannels
  });

  return { liveChannels: freshLiveChannels, scanStatus };
}

function sanitizeChannels(channels) {
  const byPath = new Map();

  for (const channel of channels || []) {
    const normalizedPath = normalizeChannelPath(channel?.urlPath || "");
    if (!normalizedPath) {
      continue;
    }

    if (byPath.has(normalizedPath)) {
      continue;
    }

    byPath.set(normalizedPath, {
      urlPath: normalizedPath,
      title: (channel?.title || normalizedPath).trim(),
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
