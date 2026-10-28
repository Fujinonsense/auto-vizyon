// Hash router. A screen is render(params, ctx) -> Node; ctx.onLeave(fn) registers cleanup.
const routes = [];
const scrolls = new Map();
let current = null;
let depth = 0;

export function route(pattern, render) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ re, keys, render });
}

export function currentPath() {
  return decodeURIComponent(location.hash.slice(1)) || '/';
}

export function go(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
    return render();
  }
  if (location.hash === hash) return render();
  depth++;
  location.hash = hash;
}

export function back(fallback = '/') {
  if (depth > 0) {
    depth--;
    history.back();
  } else {
    go(fallback, { replace: true });
  }
}

async function render() {
  const path = currentPath();
  if (current) {
    scrolls.set(current.path, window.scrollY);
    current.leave.forEach((fn) => fn());
  }
  const match = routes.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
  if (!match) return go('/', { replace: true });
  const params = Object.fromEntries(match.r.keys.map((k, i) => [k, match.m[i + 1]]));
  const ctx = { path, params, leave: [], onLeave(fn) { this.leave.push(fn); } };
  current = ctx;
  const node = await match.r.render(params, ctx);
  if (current !== ctx) return;
  document.getElementById('screen').replaceChildren(node);
  window.scrollTo(0, scrolls.get(path) || 0);
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
