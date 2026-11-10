// What the spaced carousel looked like on the last visit, so the loading skeleton can reserve the same height
// (caption block, controls row) before the slides are fetched. Purely a layout hint: never trusted for content.
//
// Without a previous visit it assumes a caption and several slides. Titles are required when a slide is created
// (carouselService.createCarouselSlide asks for at least one language), but not when it is edited, and the other
// language may be empty, so the real carousel may have no caption in the current language. In that case the first
// visit shrinks once (the skeleton reserved a caption that never came) and every later visit is exact, because the
// hint then says `caption: false`.
//
// `captionHeight` is the measured height of the caption block (it depends on how many lines the texts take, which only
// a measurement knows) and is only used when it was measured at the same viewport width.
const KEY = 'hero-carousel-shape';
const MAX_CAPTION_HEIGHT = 400;

const sane = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CAPTION_HEIGHT;

// Only an explicit `false` turns a part off; anything unreadable or hostile keeps the safe default.
export const readHeroShape = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    return {
      caption: stored?.caption !== false,
      multiple: stored?.multiple !== false,
      captionHeight: sane(stored?.captionHeight) && stored?.width === window.innerWidth ? stored.captionHeight : null,
    };
  } catch {
    return { caption: true, multiple: true, captionHeight: null };
  }
};

export const saveHeroShape = ({ caption, multiple, captionHeight }) => {
  try {
    const shape = { caption: Boolean(caption), multiple: Boolean(multiple), width: window.innerWidth };
    if (caption && sane(captionHeight)) shape.captionHeight = captionHeight;
    localStorage.setItem(KEY, JSON.stringify(shape));
  } catch {
    // storage unavailable (private mode, quota): the skeleton just uses the default
  }
};
