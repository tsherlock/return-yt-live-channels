chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_SUBSCRIPTIONS") {
    return false;
  }

  (async () => {
    const channels = await scrapeSubscriptionsFromChannelsPage();
    sendResponse(channels);
  })().catch(() => {
    sendResponse([]);
  });
  return true;
});

async function scrapeSubscriptionsFromChannelsPage() {
  if (window.location.pathname !== "/feed/channels") {
    return [];
  }

  return collectChannelsFromSubscriptionsPage();
}

async function collectChannelsFromSubscriptionsPage() {
  const channels = [];
  const seenPaths = new Set();
  const MAX_PASSES = 60;
  const STAGNANT_LIMIT = 8;
  const SCROLL_DELAY_MS = 700;
  let stagnantCountPasses = 0;
  let stagnantHeightPasses = 0;
  let previousCount = 0;
  let previousScrollHeight = 0;

  for (let pass = 0; pass < MAX_PASSES && stagnantCountPasses < STAGNANT_LIMIT && stagnantHeightPasses < STAGNANT_LIMIT; pass += 1) {
    const links = document.querySelectorAll(
      "#primary a[href^='/@'], #primary a[href^='/channel/']"
    );
    collectChannelCardLinksInto(links, channels, seenPaths);

    if (channels.length === previousCount) {
      stagnantCountPasses += 1;
    } else {
      stagnantCountPasses = 0;
      previousCount = channels.length;
    }

    window.scrollTo(0, document.documentElement.scrollHeight);
    await delay(SCROLL_DELAY_MS);

    const currentScrollHeight = document.documentElement.scrollHeight;
    if (currentScrollHeight === previousScrollHeight) {
      stagnantHeightPasses += 1;
    } else {
      stagnantHeightPasses = 0;
      previousScrollHeight = currentScrollHeight;
    }
  }

  await hydrateMissingThumbnails(channels);
  window.scrollTo(0, 0);

  return channels;
}

function collectChannelCardLinksInto(links, channels, seenPaths) {
  for (const link of links) {
    // Ignore guide/sidebar links (e.g. "Your channel" in left nav).
    if (link.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer")) {
      continue;
    }

    // Prefer actual channel cards, but allow fallback wrappers because YouTube frequently reshapes this page.
    const card = link.closest(
      "ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer"
    ) || link.closest("#primary #contents > *") || link.closest("#primary") || link;

    const href = link.getAttribute("href") || "";
    const normalizedHref = normalizeChannelPath(href);

    if (!normalizedHref.startsWith("/@") && !/^\/channel\/UC/i.test(normalizedHref)) {
      continue;
    }

    if (seenPaths.has(normalizedHref)) {
      continue;
    }

    const titleEl = card.querySelector("#title, yt-formatted-string#title, #channel-title, yt-formatted-string#channel-title");
    const img = card.querySelector("img");
    const imgShadow = card.querySelector("yt-img-shadow");
    const title = extractChannelTitle(titleEl?.textContent || link.textContent || href, href);

    if (isOwnChannelListing(card, title, normalizedHref)) {
      continue;
    }

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
    seenPaths.add(normalizedHref);
  }
}

async function hydrateMissingThumbnails(channels) {
  const missingByPath = new Map(
    channels
      .filter((channel) => !channel.thumbnailUrl)
      .map((channel) => [channel.urlPath, channel])
  );

  if (!missingByPath.size) {
    return;
  }

  for (let pass = 0; pass < 6 && missingByPath.size; pass += 1) {
    const links = document.querySelectorAll(
      "#primary a[href^='/@'], #primary a[href^='/channel/']"
    );

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const normalizedHref = normalizeChannelPath(href);
      const channel = missingByPath.get(normalizedHref);
      if (!channel) {
        continue;
      }

      const card = link.closest(
        "ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer"
      ) || link.closest("#primary #contents > *") || link.closest("#primary") || link;

      const thumbnailUrl = extractThumbnailUrl(card);
      if (thumbnailUrl) {
        channel.thumbnailUrl = thumbnailUrl;
        missingByPath.delete(normalizedHref);
      }
    }

    if (missingByPath.size) {
      window.scrollBy(0, Math.max(window.innerHeight, 800));
      await delay(400);
    }
  }
}

function extractThumbnailUrl(root) {
  const img = root?.querySelector("img");
  const imgShadow = root?.querySelector("yt-img-shadow");

  return (
    (img?.currentSrc && img.currentSrc.startsWith("http") ? img.currentSrc : "") ||
    (img?.src && img.src.startsWith("http") ? img.src : "") ||
    imgShadow?.getAttribute("data-thumb") ||
    img?.getAttribute("data-thumb") ||
    ""
  );
}

function extractChannelTitle(rawTitle, href) {
  const normalizedTitle = (rawTitle || "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) {
    return href;
  }

  const doubledTitle = normalizedTitle.match(/^(.+?)\s+\1$/i);
  if (doubledTitle) {
    return doubledTitle[1].trim();
  }

  return normalizedTitle;
}

function isOwnChannelListing(card, title, href) {
  const normalizedTitle = (title || "").trim().toLowerCase();
  const normalizedCardText = (card?.textContent || card?.innerText || "").trim().toLowerCase();
  const normalizedAriaLabel = (card?.getAttribute?.("aria-label") || "").trim().toLowerCase();
  const normalizedCardTitle = (card?.getAttribute?.("title") || "").trim().toLowerCase();

  const selfHints = [
    "your channel",
    "my channel",
    "view your channel",
    "edit channel",
    "customize channel",
    "youtube studio",
    "channel dashboard",
    "manage videos"
  ];

  const titleLooksLikeOwnChannel = selfHints.some((hint) => normalizedTitle === hint);
  const cardLooksLikeOwnChannel =
    normalizedAriaLabel === "your channel" ||
    normalizedCardTitle === "your channel";

  const looksLikeChannelPath = /^\/channel\/UC/i.test(href) || /^\/@/i.test(href);

  return looksLikeChannelPath && (titleLooksLikeOwnChannel || cardLooksLikeOwnChannel);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
