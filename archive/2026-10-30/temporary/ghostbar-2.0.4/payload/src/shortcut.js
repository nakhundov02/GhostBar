'use strict';
(function (root) {
  const DEFAULT = Object.freeze({ enabled: true, code: 'Backquote', ctrl: true, alt: false, shift: false, meta: false });
  const CODES = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/;
  function normalize(value = DEFAULT) {
    if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !CODES.test(value.code) ||
        !['enabled', 'ctrl', 'alt', 'shift', 'meta'].every(key => typeof value[key] === 'boolean') ||
        !(value.ctrl || value.alt || value.meta)) {
      throw new Error('Choose Control, Option, or Command together with another key.');
    }
    return { enabled: value.enabled, code: value.code, ctrl: value.ctrl, alt: value.alt, shift: value.shift, meta: value.meta };
  }
  function matches(event, shortcut) {
    return shortcut.enabled && !event.repeat && !event.isComposing && event.code === shortcut.code &&
      event.ctrlKey === shortcut.ctrl && event.altKey === shortcut.alt &&
      event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta;
  }
  function label(shortcut) {
    const symbols = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page Up', PageDown: 'Page Down' };
    const key = symbols[shortcut.code] || shortcut.code.replace(/^(Key|Digit)/, '');
    return [shortcut.ctrl && 'Control', shortcut.alt && 'Option', shortcut.shift && 'Shift', shortcut.meta && 'Command', key].filter(Boolean).join(' + ');
  }
  const api = { DEFAULT, normalize, matches, label };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GhostBarShortcut = api;
})(globalThis);
