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
      "h2 a",
      "h3 a",
      "h4 a",
      "strong a",
    ],
    time: ['time[datetime]', "abbr[data-utime]"],
    image: ['img[src*="scontent"]', 'img[src*="fbcdn"]', "img[src]"],
  };
  root.MyBotSelectors = SELECTORS;
  if (typeof module !== "undefined" && module.exports) module.exports = SELECTORS;
})(typeof globalThis !== "undefined" ? globalThis : this);
