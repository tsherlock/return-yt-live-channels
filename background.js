const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const LIVE_CACHE_KEY = "liveChannelsCacheV3";
const CHANNEL_LIST_KEY = "channelListV1";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LIVE_CHANNELS") {
    return false;
  }

  loadLiveChannels({ forceRefresh: Boolean(message.forceRefresh) })
    .then((liveChannels) => sendResponse({ ok: true, liveChannels }))
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

async function checkChannelLive(channel) {
  try {
    const response = await fetch(`https://www.youtube.com${channel.urlPath}/live`, {
      redirect: "follow"
    });

    if (!response.ok) {
      return null;
    }

    const finalUrl = response.url;

    // Try redirect case first.
    if (finalUrl.includes("/watch?v=")) {
      const liveVideoId = new URL(finalUrl).searchParams.get("v");
      if (liveVideoId && await isWatchPageLive(liveVideoId)) {
        return { ...channel, liveVideoId };
      }
    }

    // If /live does not redirect, require live markers and verify candidates.
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
  if (!forceRefresh) {
    const liveCache = await getFreshCache(LIVE_CACHE_KEY, LIVE_CACHE_TTL_MS);
    if (liveCache) {
      return liveCache.items;
    }
  }

  const channels = (await getChannelList()).filter((channel) => !channel.excludeFromLive);

  if (!channels.length) {
    await saveCache(LIVE_CACHE_KEY, []);
    return [];
  }

  // Check in batches of 10 to avoid hammering YouTube
  const BATCH_SIZE = 10;
  const liveChannels = [];

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(checkChannelLive));

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        liveChannels.push(result.value);
      }
    }
  }
  await saveCache(LIVE_CACHE_KEY, liveChannels);
  return liveChannels;
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
