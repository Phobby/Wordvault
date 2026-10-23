// The colours of a block of text in a scanned picture: what is behind the letters and what the
// letters are. A translation written over the block uses them, so that it looks like the text
// it replaces (dark on light, light on dark, white on a coloured button) instead of a patch.
// Runs on the picture inside readCapture() (pipeline.js); only the two colours leave it.

/** About this many pixels of a block are looked at; plenty to tell two colours apart. */
const SAMPLES = 3000;
/** Two colours closer than this in brightness (0-255) cannot be read one on the other. */
const MIN_CONTRAST = 70;

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const hex = ([r, g, b]) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/**
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image  RGBA pixels.
 * @param {{ x: number, y: number, width: number, height: number }} box  In the image's pixels.
 * @returns {{ background: string, text: string } | null}  '#rrggbb'; null for an empty box.
 */
export function blockColours(image, box) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(image.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(image.height, Math.ceil(box.y + box.height));
  if (right <= left || bottom <= top) return null;
  const step = Math.max(1, Math.floor(Math.sqrt(((right - left) * (bottom - top)) / SAMPLES)));
  const samples = [];
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const at = (y * image.width + x) * 4;
      const [r, g, b] = [image.data[at], image.data[at + 1], image.data[at + 2]];
      samples.push([r, g, b, luminance(r, g, b)]);
    }
  }
  // Letters are thin: of the two kinds of pixel in a block of text, the background is the one
  // there is more of. The two kinds are told apart by brightness, around the average.
  const mean = samples.reduce((sum, sample) => sum + sample[3], 0) / samples.length;
  const light = samples.filter((sample) => sample[3] >= mean);
  const dark = samples.filter((sample) => sample[3] < mean);
  // The middle value, not the average: the soft edges of the letters are part of either group,
  // and an average would tint the background towards the letters (a visible patch).
  const median = (group) =>
    [0, 1, 2].map((channel) => {
      const values = group.map((sample) => sample[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    });
  const [back, front] = light.length >= dark.length ? [light, dark] : [dark, light];
  const background = median(back);
  const backLuminance = luminance(...background);
  // The letters' own colour: the half of their pixels furthest from the background (the rest are edges).
  const core = [...front].sort((a, b) => Math.abs(b[3] - backLuminance) - Math.abs(a[3] - backLuminance)).slice(0, Math.max(1, Math.ceil(front.length / 2)));
  let text = front.length > 0 ? median(core) : null;
  // Too close to read (a flat block, or text the engine found in noise): black or white, whichever reads.
  if (!text || Math.abs(luminance(...text) - backLuminance) < MIN_CONTRAST) text = backLuminance > 140 ? [17, 17, 17] : [250, 250, 250];
  return { background: hex(background), text: hex(text) };
}
