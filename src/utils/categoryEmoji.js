<<<<<<< HEAD
// Maps keywords in item name/description to category emojis.
const RULES = [
  { keywords: ['cable', 'usb', 'wire', 'connector', 'plug', 'adapter'], emoji: '🔌' },
  { keywords: ['box', 'storage', 'container', 'organizer'], emoji: '📦' },
  { keywords: ['resistor', 'capacitor', 'led', 'transistor', 'ic ', 'chip'], emoji: '⚡' },
  { keywords: ['arduino', 'esp', 'board', 'breadboard', 'devkit'], emoji: '🖥️' },
  { keywords: ['screw', 'nut', 'bolt', 'mount'], emoji: '🔩' },
  { keywords: ['sensor', 'servo', 'motor', 'relay'], emoji: '🎛️' },
  { keywords: ['kit', 'assorted', 'pack'], emoji: '🧰' },
];

const DEFAULT_EMOJI = '📎';

export function getCategoryEmoji(engName) {
  const lower = String(engName ?? '').toLowerCase();
  for (const { keywords, emoji } of RULES) {
    if (keywords.some(k => lower.includes(k))) return emoji;
  }
  return DEFAULT_EMOJI;
}
=======
// Maps keywords in item name/description to category emojis.
const RULES = [
  { keywords: ['cable', 'usb', 'wire', 'connector', 'plug', 'adapter'], emoji: '🔌' },
  { keywords: ['box', 'storage', 'container', 'organizer'], emoji: '📦' },
  { keywords: ['resistor', 'capacitor', 'led', 'transistor', 'ic ', 'chip'], emoji: '⚡' },
  { keywords: ['arduino', 'esp', 'board', 'breadboard', 'devkit'], emoji: '🖥️' },
  { keywords: ['screw', 'nut', 'bolt', 'mount'], emoji: '🔩' },
  { keywords: ['sensor', 'servo', 'motor', 'relay'], emoji: '🎛️' },
  { keywords: ['kit', 'assorted', 'pack'], emoji: '🧰' },
];

const DEFAULT_EMOJI = '📎';

export function getCategoryEmoji(engName) {
  const lower = String(engName ?? '').toLowerCase();
  for (const { keywords, emoji } of RULES) {
    if (keywords.some(k => lower.includes(k))) return emoji;
  }
  return DEFAULT_EMOJI;
}
>>>>>>> fea0a82cfd606a9ad96144983f837e51af84636f
