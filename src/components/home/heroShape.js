// What the spaced carousel looked like on the last visit, so the loading skeleton can reserve the same height
// (caption block, controls row) before the slides are fetched. Purely a layout hint: never trusted for content.
const KEY = 'hero-carousel-shape';
const UNKNOWN = { caption: true, multiple: true }; // production slides have a title and are several

// Only an explicit `false` turns a part off; anything unreadable or hostile keeps the safe default.
export const readHeroShape = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    return {
      caption: stored?.caption !== false,
      multiple: stored?.multiple !== false,
    };
  } catch {
    return UNKNOWN;
  }
};

export const saveHeroShape = ({ caption, multiple }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ caption: Boolean(caption), multiple: Boolean(multiple) }));
  } catch {
    // storage unavailable (private mode, quota): the skeleton just uses the default
  }
};
