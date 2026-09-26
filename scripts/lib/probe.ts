/**
 * In-page geometry probe.
 *
 * Returns whether the document scrolls horizontally, and — crucially — WHICH
 * elements stick out past the viewport. Knowing the culprit is what turns
 * "something is broken" into a one-line fix; scrollWidth alone cannot.
 *
 * The probe is deliberately tolerant of legitimate exceptions: an element may
 * be wider than the viewport on purpose (a deliberately scrollable table), so
 * each offender reports whether it is itself scrollable or clipped by an
 * ancestor. Those are the two acceptable ways to contain a wide child.
 */
export const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;

  // A page has horizontal overflow when it can scroll sideways.
  const scrollW = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const overflow = scrollW - vw;

  // Style helpers, cached because the walk below calls them a lot.
  const styleOf = (el) => getComputedStyle(el);

  // An element is "contained" if some ancestor clips or scrolls its overflow.
  const isContained = (el) => {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const s = styleOf(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') return true;
      p = p.parentElement;
    }
    return false;
  };

  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const s = styleOf(el);
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\\s+/).slice(0, 4).join(' ')
      : '';
    return {
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0, 120),
      right: Math.round(r.right),
      width: Math.round(r.width),
      // How far this element itself pokes past the viewport.
      poke: Math.round(Math.max(0, r.right - vw)),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
      scrollable: s.overflowX === 'auto' || s.overflowX === 'scroll',
      contained: isContained(el),
      minW: s.minWidth,
      fixedW: s.width,
    };
  };

  // Candidates: anything whose painted box extends beyond the viewport.
  const all = Array.from(document.querySelectorAll('body *'));
  const offenders = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    offenders.push(describe(el));
  }

  // Report the OUTERMOST offenders, which are the real causes; a child of an
  // overflowing parent is only a symptom.
  const outermost = offenders.filter((o) => !offenders.some((p) =>
    p !== o && p.width > o.width && p.right >= o.right && p.poke >= o.poke && p.poke > 0
  )).slice(0, 8);

  return {
    vw,
    scrollW,
    overflow,
    offenders: outermost.length ? outermost : offenders.slice(0, 8),
    totalOffenders: offenders.length,
  };
})()`;
