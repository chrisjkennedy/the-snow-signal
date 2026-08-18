// Native `title` tooltips are unreliable: they take about a second to appear,
// they do nothing at all on touch, and browsers render them inconsistently
// when the text is long. Every explanatory number on this site depends on
// hover, so we take over from `title` and draw the tooltip ourselves.

let pop = null;
let current = null;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'tip-pop';
  pop.setAttribute('role', 'tooltip');
  pop.id = 'tip-pop';
  document.body.appendChild(pop);
  return pop;
}

// Elements keep their text in data-tip. The first time one is hovered we move
// `title` across and delete it, so the native tooltip never gets to fire.
function tipTextFor(el) {
  if (el.hasAttribute('title')) {
    const t = el.getAttribute('title');
    if (t) el.dataset.tip = t;
    el.removeAttribute('title');
  }
  return el.dataset.tip || '';
}

function place(el) {
  const r = el.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const margin = 8;

  // Prefer above the element; drop below when there isn't room up there.
  let top = r.top - p.height - 9;
  if (top < margin) top = r.bottom + 9;

  let left = r.left + r.width / 2 - p.width / 2;
  left = Math.min(Math.max(left, margin), window.innerWidth - p.width - margin);

  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

function show(el) {
  const text = tipTextFor(el);
  if (!text) return;
  ensurePop();
  pop.textContent = text;
  pop.style.visibility = 'hidden';
  pop.classList.add('on');
  place(el);           // measure with real content before revealing
  pop.style.visibility = '';
  el.setAttribute('aria-describedby', 'tip-pop');
  current = el;
}

function hide() {
  if (!pop) return;
  pop.classList.remove('on');
  if (current) current.removeAttribute('aria-describedby');
  current = null;
}

const SELECTOR = '[title], [data-tip]';

export function initTooltips() {
  ensurePop();

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest(SELECTOR);
    if (!el) { if (current) hide(); return; }
    if (el === current) return;
    show(el);
  });

  document.addEventListener('pointerout', (e) => {
    if (!current) return;
    if (e.relatedTarget && current.contains(e.relatedTarget)) return;
    if (e.target.closest(SELECTOR) === current) hide();
  });

  // Touch has no hover, so a tap on an explained value opens its tooltip and
  // a tap anywhere else closes it.
  document.addEventListener('click', (e) => {
    const el = e.target.closest(SELECTOR);
    if (!el) { hide(); return; }
    if (el === current) hide();
    else show(el);
  });

  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
