// A 24px dot stays visually small but gets a 44x44 touch area from an invisible ::before (it is positioned from the
// padding box, inside the 2px border: 20px + 2 x 12px = 44px). With the 20px gap between
// dots (gap-5) the areas tile exactly (24 + 20 = 44px pitch) instead of overlapping.
export const DOT_HIT_AREA = "relative before:absolute before:-inset-3 before:content-['']";
export const DOT_GAP = 'gap-5';
