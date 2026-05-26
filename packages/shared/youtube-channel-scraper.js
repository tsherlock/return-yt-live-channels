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
  let stagnantPasses = 0;
  let previousCount = 0;

  for (let pass = 0; pass < 24 && stagnantPasses < 3; pass += 1) {
    const links = document.querySelectorAll(
      "#primary a[href^='/@'], #primary a[href^='/channel/']"
    );
    collectChannelCardLinksInto(links, channels, seenPaths);

    if (channels.length === previousCount) {
      stagnantPasses += 1;
    } else {
      stagnantPasses = 0;
      previousCount = channels.length;
    }

    window.scrollTo(0, document.documentElement.scrollHeight);
    await delay(500);
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

    // Only accept links that belong to actual channel cards on /feed/channels.
    // This avoids nav/account links across languages and account types.
    const card = link.closest("ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer");
    if (!card) {
      continue;
    }

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
    const title = (titleEl?.textContent || link.textContent || href).trim();

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
    const links = document.querySelectorAll("#primary a[href^='/@'], #primary a[href^='/channel/']");

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const normalizedHref = normalizeChannelPath(href);
      const channel = missingByPath.get(normalizedHref);
      if (!channel) {
        continue;
      }

      const card = link.closest("ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer");
      if (!card) {
        continue;
      }

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

  const haystack = [normalizedTitle, normalizedCardText, normalizedAriaLabel, normalizedCardTitle]
    .filter(Boolean)
    .join(" ");

  const titleLooksLikeOwnChannel = selfHints.some((hint) => normalizedTitle.includes(hint));
  const cardLooksLikeOwnChannel = selfHints.some((hint) => haystack.includes(hint));

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
