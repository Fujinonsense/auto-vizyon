// Just enough of a browser page for the app's screens in node: elements built with h(), text, simple
// selectors (tag, #id, .class, [attr], [attr="value"], descendants), focus and blur, events, the page's
// top bar / screen / tab bar, and history + location for the router. No layout and no CSS.
class FakeNode {
  constructor() { this.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = String(text);
  }
  get textContent() { return this.data; }
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const event = (type, init = {}) => ({ type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init });

// One compound selector ("button.chip[data-key="boya"]") against one element.
function matchesCompound(el, compound) {
  const m = /^([a-z0-9*-]*)((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(compound);
  if (!m) throw new Error(`fake-dom: selector not supported: ${compound}`);
  if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
  for (const [, kind, name, value] of m[2].matchAll(/([.#]|\[)([\w-]+)(?:="([^"]*)")?\]?/g)) {
    if (kind === '.' && !el.classList.contains(name)) return false;
    if (kind === '#' && el.id !== name) return false;
    if (kind === '[' && (!el.hasAttribute(name) || (value !== undefined && el.getAttribute(name) !== value))) return false;
  }
  return true;
}

function matches(el, selector) {
  return selector.split(',').some((part) => {
    const steps = part.trim().split(/\s+/);
    if (!matchesCompound(el, steps.at(-1))) return false;
    let i = steps.length - 2;
    for (let up = el.parentNode; up && i >= 0; up = up.parentNode) if (matchesCompound(up, steps[i])) i--;
    return i < 0;
  });
}

class FakeElement extends FakeNode {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.scrolledIntoView = 0;
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    this.classList = {
      contains: (c) => list().includes(c),
      add: (...cs) => { el.className = [...new Set([...list(), ...cs])].join(' '); },
      remove: (...cs) => { el.className = list().filter((c) => !cs.includes(c)).join(' '); },
      toggle: (c, force) => {
        const on = force === undefined ? !list().includes(c) : !!force;
        if (on) el.classList.add(c);
        else el.classList.remove(c);
        return on;
      },
    };
    // icon(): <template> parses the svg markup; here it simply hands out an svg element.
    if (this.tagName === 'TEMPLATE') this.content = { get firstChild() { return new FakeElement('svg', doc); } };
  }

  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get children() { return this.childNodes.filter((n) => n instanceof FakeElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get offsetWidth() { return 0; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(text) { this.replaceChildren(...(text == null || text === '' ? [] : [String(text)])); }

  setAttribute(name, value) {
    const v = String(value);
    this.attributes.set(name, v);
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = v;
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name) || (name === 'class' && !!this.className); }

  append(...nodes) {
    for (const n of nodes) {
      const node = n instanceof FakeNode ? n : new FakeText(n);
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.childNodes.indexOf(this);
    this.remove();
    const added = nodes.map((n) => (n instanceof FakeNode ? n : new FakeText(n)));
    added.forEach((n) => { n.remove(); n.parentNode = parent; });
    parent.childNodes.splice(at, 0, ...added);
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((c) => c !== node);
    node.parentNode = null;
    return node;
  }
  contains(node) {
    for (let x = node; x; x = x.parentNode) if (x === this) return true;
    return false;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((f) => f !== fn));
  }
  // Runs this element's own listeners (no bubbling) and returns what they returned.
  dispatchEvent(e) {
    e.target ??= this;
    e.currentTarget = this;
    return (this.listeners.get(e.type) || []).map((fn) => fn(e));
  }
  click() {
    if (this.disabled) return [];
    return this.dispatchEvent(event('click'));
  }
  focus() {
    const doc = this.ownerDocument;
    if (doc.activeElement === this || this.disabled) return;
    const prev = doc.activeElement;
    doc.activeElement = this;
    if (prev && prev !== doc.body) prev.dispatchEvent(event('blur'));
    this.dispatchEvent(event('focus'));
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.dispatchEvent(event('blur'));
  }
  scrollIntoView() { this.scrolledIntoView++; }

  matches(selector) { return matches(this, selector); }
  closest(selector) {
    for (let x = this; x instanceof FakeElement; x = x.parentNode) if (matches(x, selector)) return x;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (el) => el.children.forEach((c) => {
      if (matches(c, selector)) out.push(c);
      walk(c);
    });
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

// Puts the page in place (document, Node, window, history, location, requestAnimationFrame) and returns
// it with helpers; uninstall() puts the globals back as they were.
export function installDom() {
  const names = ['document', 'Node', 'window', 'history', 'location', 'requestAnimationFrame', 'matchMedia'];
  const saved = names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]);
  const doc = {
    createElement: (tag) => new FakeElement(tag, doc),
    getElementById: (id) => [doc.body, ...doc.body.querySelectorAll('*')].find((e) => e.id === id) ?? null,
    querySelector: (selector) => doc.body.querySelector(selector),
    querySelectorAll: (selector) => doc.body.querySelectorAll(selector),
    addEventListener() {},
    removeEventListener() {},
  };
  doc.body = new FakeElement('body', doc);
  doc.activeElement = doc.body;
  for (const [tag, id] of [['header', 'topbar'], ['main', 'screen'], ['nav', 'tabbar']]) {
    const el = doc.createElement(tag);
    el.setAttribute('id', id);
    doc.body.append(el);
  }
  const location = { hash: '' };
  const values = {
    document: doc,
    Node: FakeNode,
    window: { scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {} },
    history: { replaceState: (state, title, url) => { location.hash = url; }, back() {} },
    location,
    requestAnimationFrame: (fn) => queueMicrotask(() => fn(0)),
    matchMedia: () => ({ matches: false }),
  };
  for (const n of names) Object.defineProperty(globalThis, n, { value: values[n], configurable: true, writable: true });

  return {
    document: doc,
    uninstall() {
      for (const [n, d] of saved) {
        if (d) Object.defineProperty(globalThis, n, d);
        else delete globalThis[n];
      }
    },
  };
}

// The value typed into an input, as the browser reports it (an "input" event), optionally leaving it.
export function type(input, text, { leave = false } = {}) {
  input.focus();
  input.value = text;
  input.dispatchEvent(event('input'));
  if (leave) input.blur();
}

export const byText = (root, selector, text) => root.querySelectorAll(selector).find((el) => el.textContent.trim() === text) ?? null;

// Lets IndexedDB (fake-indexeddb runs on setImmediate) and the promises waiting on it finish.
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}
