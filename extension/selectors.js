(function (root) {
  const SELECTORS = {
    article: ['[role="article"]', "[aria-posinset]", '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]'],
    text: [
      '[data-ad-preview="message"]',
      '[data-ad-comet-preview="message"]',
      '[data-testid="post_message"]',
      'div[dir="auto"]',
    ],
    permalink: [
      'a[href*="/posts/"]',
      'a[href*="/permalink/"]',
      'a[href*="story_fbid"]',
      'a[href*="multi_permalinks"]',
      'a[href*="/groups/"]',
    ],
    author: [
      '[data-ad-rendering-role="profile_name"] a',
      '[data-ad-rendering-role="profile_name"] strong',
      '[data-ad-rendering-role="profile_name"]',
      "h2 a",
      "h3 a",
      "h4 a",
      "strong a",
      "h2 strong",
      "h3 strong",
      "h4 strong",
      "h2 span",
      "h3 span",
    ],
    time: ['time[datetime]', "abbr[data-utime]"],
    image: ['img[src*="scontent"]', 'img[src*="fbcdn"]', "img[src]"],
    // Inline "See more" toggles inside a post body. Read-only: their text is removed, they are never clicked.
    seeMore: ['[role="button"]', 'div[tabindex="0"]', "span[tabindex]"],
    marketplace: {
      card: ['a[href*="/marketplace/item/"]'],
      image: ['img[src*="scontent"]', 'img[src*="fbcdn"]', "img[src]"],
    },
  };
  root.MyBotSelectors = SELECTORS;
  if (typeof module !== "undefined" && module.exports) module.exports = SELECTORS;
})(typeof globalThis !== "undefined" ? globalThis : this);
