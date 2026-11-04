// Exercise the production viewer controller without downloading any photographs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../portfolio/photo-viewer.js', import.meta.url), 'utf8');

function element(rect = {}) {
  const events = new Map(), children = new Map(), classes = new Set();
  const node = {
    dataset: {}, style: { setProperty() {} }, hidden: false, tabIndex: 0,
    classList: { contains: (name) => classes.has(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, remove: (name) => classes.delete(name) },
    getAttribute(key) { return this[key] ?? null; },
    setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
    addEventListener(name, listener) { if (!events.has(name)) events.set(name, []); events.get(name).push(listener); },
    emit(name, event) { events.get(name)?.forEach((listener) => listener(event)); },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800, bottom: 800, ...rect }; },
    getClientRects() { return [{}]; }, insertAdjacentHTML() {}, closest() { return null; },
    focus() { document.activeElement = node; },
  };
  return node;
}
let instance;
const main = element(), root = element(), canvas = element();
const top = root.querySelector('.viewer-top'); top.getBoundingClientRect = () => ({ bottom: 70 });
let trayTop = 670;
root.querySelector('.viewer-bottom').getBoundingClientRect = () => ({ top: trayTop });
root.requestFullscreen = async () => { document.fullscreenElement = root; };
const triggers = Array.from({ length: 35 }, (_, index) => {
  const trigger = element();
  trigger.dataset = { photo: `assets/photo-${index}-v2.jpg`, caption: `Photo ${index}`, taken: '2026-10-31', takenLabel: 'October 31, 2026' };
  if (index === 0) trigger.dataset.photoId = 'curated-id';
  trigger.querySelector('img').src = `https://example.test/preview-${index}.jpg`;
  return trigger;
});
const documentEvents = new Map(), dispatched = [];
const document = {
  baseURI: 'https://example.test/pictures.html', activeElement: triggers[0],
  querySelector: () => main, querySelectorAll: () => triggers,
  addEventListener(name, listener) { if (!documentEvents.has(name)) documentEvents.set(name, []); documentEvents.get(name).push(listener); },
  dispatchEvent(event) { dispatched.push(event); documentEvents.get(event.type)?.forEach((listener) => listener(event)); },
  exitFullscreen: async () => { document.fullscreenElement = null; },
};
class FakeViewer {
  constructor(_main, options) {
    instance = this; this.options = options; this.viewer = root; this.canvas = canvas;
    this.imageData = {}; this.isShown = false; this.viewed = false; this.index = 0; this.turns = 0;
  }
  start() { this.options.ready(); this.isShown = true; this.options.shown(); }
  view(index) {
    this.index = index; this.image = element(); this.image.src = new URL(triggers[index].dataset.photo, document.baseURI).href;
    this.imageData = { naturalWidth: 1600, naturalHeight: 1000, width: 1600, height: 1000, ratio: 1, rotate: 0, x: 0, y: 0 };
    this.options.view({ detail: { index, image: this.image } });
    this.viewed = true; this.options.viewed({ detail: { index, image: this.image } });
  }
  zoomTo(ratio) { this.imageData.ratio = ratio; this.imageData.width = 1600 * ratio; this.imageData.height = 1000 * ratio; }
  moveTo(x, y) { this.imageData.x = x; this.imageData.y = y; }
  prev() { this.turns--; } next() { this.turns++; }
  hide() { this.isShown = false; this.options.hidden(); }
  update() { this.updated = true; }
  zoom() {} rotate() {} reset() {}
}
const context = vm.createContext({
  document, window: { Viewer: FakeViewer, addEventListener() {} }, Viewer: FakeViewer,
  getComputedStyle: () => ({ getPropertyValue: () => '64px' }),
  requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {},
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  Image: class {}, URL, Date, Math,
});
vm.runInContext(source, context);
instance.start(); instance.view(0);
assert.equal(dispatched.find((event) => event.type === 'gallery:viewer-ready').detail.root, root);
assert.equal(root.dataset.photoId, 'curated-id');
assert.equal(dispatched.findLast((event) => event.type === 'gallery:viewer-photo').detail.photoId, 'curated-id');
assert.equal(root.querySelector('.viewer-counter').textContent, '01 / 35');
assert.equal(triggers.filter((trigger) => instance.options.filter(trigger.querySelector('img'))).length, 35);
assert.equal(instance.imageData.ratio, .568, 'photo fits measured toolbar/tray, with full composition');
assert.equal(instance.imageData.y, 82);
console.log('PASS: all collection photographs remain in the viewer and events expose stable photo identity.');

trayTop = 570;
instance.options.viewed({ detail: { index: 0, image: instance.image } });
assert.equal(instance.imageData.ratio, .468, 'a taller ratings tray reduces the available image area');
instance.imageData.rotate = 90;
instance.options.rotated();
instance.options.viewed({ detail: { index: 0, image: instance.image } });
assert.ok(Math.abs(instance.imageData.ratio - 468 / 1600) < 1e-10, 'rotated image still fits the measured stage');
console.log('PASS: wrapped ratings and rotated images are contained above the caption tray.');

function key(key, target = element(), extras = {}) {
  const event = { type: 'keydown', key, target, preventDefault() { this.defaultPrevented = true; }, ...extras };
  documentEvents.get('keydown').forEach((listener) => listener(event)); return event;
}
const ratingButton = element(); ratingButton.closest = () => root.querySelector('[data-viewer-rating]');
key('ArrowRight', ratingButton); key('r', ratingButton);
assert.equal(instance.turns, 0, 'rating keys must not navigate the photographs');
key('ArrowRight', element(), { defaultPrevented: true });
assert.equal(instance.turns, 0);
key('ArrowRight'); assert.equal(instance.turns, 1);
const firstTool = element(), selectedStar = element(), ratingDisclosure = element();
root.querySelectorAll = (selector) => selector.includes('summary') ? [firstTool, selectedStar, ratingDisclosure] : [firstTool, selectedStar];
document.activeElement = selectedStar;
assert.ok(!key('Tab', selectedStar).defaultPrevented, 'Tab can reach the native ratings disclosure after the selected star');
document.activeElement = ratingDisclosure;
assert.ok(key('Tab', ratingDisclosure).defaultPrevented);
assert.equal(document.activeElement, firstTool, 'Tab wraps only after the final disclosure control');
key('Escape', ratingButton);
assert.equal(instance.isShown, false, 'Escape closes even while a rating has focus');
assert.equal(dispatched.findLast((event) => event.type === 'gallery:viewer-hidden').type, 'gallery:viewer-hidden');
console.log('PASS: rating keyboard shortcuts stay local, while Escape closes and returns focus.');

instance.isShown = true; instance.view(1);
assert.equal(root.dataset.photoId, 'photo-1', 'asset-version suffixes never create a new rating identity');
const fullscreenButton = element(); fullscreenButton.dataset.action = 'fullscreen'; fullscreenButton.closest = () => fullscreenButton;
root.emit('click', { target: fullscreenButton, stopImmediatePropagation() {} });
await Promise.resolve();
assert.equal(document.fullscreenElement, root);
root.emit('click', { target: fullscreenButton, stopImmediatePropagation() {} });
await Promise.resolve();
assert.equal(document.fullscreenElement, null);
console.log('PASS: fullscreen uses the browser API and edited photo URLs preserve their vote identity.');
