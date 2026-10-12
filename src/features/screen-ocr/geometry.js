// Screen text scanning: from the page's CSS pixels to the pixels of a screenshot and back.
//
// A screenshot of a tab shows what is visible of the page, at whatever resolution the browser
// draws it: the screen's pixel density, the browser zoom and a pinch zoom all change how many
// image pixels one CSS pixel is. None of them is taken on trust here: the ratio is measured
// from the size of the image that actually came back.

/**
 * @typedef {Object} Viewport  What the page reports about itself at the moment of the capture.
 * @property {number} innerWidth    Layout viewport, CSS px (window.innerWidth).
 * @property {number} innerHeight
 * @property {number} [scale]       Pinch zoom (visualViewport.scale); 1 when not zoomed.
 * @property {number} [offsetLeft]  Where the visible part starts within the layout viewport
 * @property {number} [offsetTop]   (visualViewport.offsetLeft/Top); 0 when not zoomed.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

/**
 * How a screenshot relates to the page.
 * @param {{ width: number, height: number }} image  Size of the screenshot, image px.
 * @param {Viewport} viewport
 */
export function createMapping(image, viewport) {
  const zoom = viewport.scale > 0 ? viewport.scale : 1;
  // What the screenshot shows, in CSS px of the page. Pinched in, it is a part of the viewport.
  const visible = {
    x: viewport.offsetLeft || 0,
    y: viewport.offsetTop || 0,
    width: viewport.innerWidth / zoom,
    height: viewport.innerHeight / zoom,
  };
  if (!(image.width > 0 && image.height > 0 && visible.width > 0 && visible.height > 0)) {
    throw new RangeError('empty image or viewport');
  }
  // Measured separately: browsers round the image size, and not always the same way both ways.
  const scaleX = image.width / visible.width;
  const scaleY = image.height / visible.height;

  return {
    scaleX,
    scaleY,
    visible,
    /**
     * A box of the page (CSS px, relative to the layout viewport) as whole image pixels, cut
     * down to what the screenshot holds. Null when nothing of it is in the picture.
     * @param {Box} box
     * @returns {Box | null}
     */
    toImage(box) {
      const left = Math.max(0, Math.floor((box.x - visible.x) * scaleX));
      const top = Math.max(0, Math.floor((box.y - visible.y) * scaleY));
      const right = Math.min(image.width, Math.ceil((box.x + box.width - visible.x) * scaleX));
      const bottom = Math.min(image.height, Math.ceil((box.y + box.height - visible.y) * scaleY));
      if (right - left < 1 || bottom - top < 1) return null;
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    /**
     * A box found in a crop of the screenshot, back on the page.
     * @param {Box} box     Image px, relative to the crop.
     * @param {Box} crop    The crop within the screenshot (as returned by toImage).
     * @param {number} [enlarged]  How many times the crop was enlarged before it was read.
     * @returns {Box} CSS px, relative to the layout viewport.
     */
    toPage(box, crop, enlarged = 1) {
      return {
        x: visible.x + (crop.x + box.x / enlarged) / scaleX,
        y: visible.y + (crop.y + box.y / enlarged) / scaleY,
        width: box.width / enlarged / scaleX,
        height: box.height / enlarged / scaleY,
      };
    },
  };
}

/** The whole visible page as a box, for "scan everything". */
export function wholeViewport(viewport) {
  const zoom = viewport.scale > 0 ? viewport.scale : 1;
  return { x: viewport.offsetLeft || 0, y: viewport.offsetTop || 0, width: viewport.innerWidth / zoom, height: viewport.innerHeight / zoom };
}

/**
 * What an engine found, placed on the page. Words keep their line and block; lines and blocks
 * get the box that holds their words.
 *
 * @param {{ words: Object[] }} found  Engine output; `bbox` of each word in px of the image it was given.
 * @param {ReturnType<typeof createMapping>} mapping
 * @param {Box} crop
 * @param {number} [enlarged]
 */
export function placeOnPage(found, mapping, crop, enlarged = 1) {
  const words = found.words.map((word, index) => ({
    id: index,
    text: word.text,
    confidence: word.confidence,
    lineId: word.lineId,
    blockId: word.blockId,
    rect: mapping.toPage(word.bbox, crop, enlarged),
  }));
  return { words, lines: group(words, 'lineId'), blocks: group(words, 'blockId') };
}

/** Words that share a line (or a block), in reading order, with the box around them. */
function group(words, key) {
  const groups = new Map();
  for (const word of words) {
    if (!groups.has(word[key])) groups.set(word[key], []);
    groups.get(word[key]).push(word);
  }
  return [...groups].map(([id, members]) => {
    const left = Math.min(...members.map((word) => word.rect.x));
    const top = Math.min(...members.map((word) => word.rect.y));
    const right = Math.max(...members.map((word) => word.rect.x + word.rect.width));
    const bottom = Math.max(...members.map((word) => word.rect.y + word.rect.height));
    return {
      id,
      text: members.map((word) => word.text).join(' '),
      words: members.map((word) => word.id),
      rect: { x: left, y: top, width: right - left, height: bottom - top },
    };
  });
}
