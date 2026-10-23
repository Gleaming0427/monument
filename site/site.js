// Loading states for a site that is already complete without this file.
//
// Nothing here is required to read the page: with scripting off, every picture is simply visible and every
// fact is on the page. What this adds is the part a reader would otherwise spend waiting through — a shape
// that holds the place of a file still on its way, a line at the foot saying how far down the page is, and
// a verdict when a file never arrives at all.
(() => {
  'use strict';

  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const all = (selector, scope) => [...(scope ?? document).querySelectorAll(selector)];

  // ——— Media ————————————————————————————————————————————————————————————————————————————————
  // A frame resolves to one of three states: loaded (the picture is there), failed (it is not coming), or
  // still pending (shimmer). The pending state is the only one that costs anything, so it is the only one
  // the script puts on: it starts them all pending and takes them off as each one settles.
  //
  // The picture settles the frame, never the film. A recorded construction lies over its own photograph, and
  // that photograph is what a reader can rely on: autoplay can be refused, a film can stall behind a data
  // saver, a browser can decline to decode it at all. None of that should leave a grey box where a building
  // should be. So the poster settles the frame, and the video is revealed on its own once it has a frame
  // to show — which may be never, and is fine.
  const settle = frame => {
    frame.classList.remove('is-pending', 'is-failed');
    frame.classList.add('is-loaded');
    frame.removeAttribute('aria-busy');
  };
  const fail = frame => {
    frame.classList.remove('is-pending');
    frame.classList.add('is-loaded', 'is-failed');
    frame.removeAttribute('aria-busy');
  };

  const watchFrame = frame => {
    if (frame.dataset.watched) return;
    frame.dataset.watched = '1';
    const poster = frame.querySelector('img'), video = frame.querySelector('video');
    if (!poster && !video) { settle(frame); return; }
    frame.classList.add('is-pending');
    frame.setAttribute('aria-busy', 'true');

    if (poster) {
      // Already decoded before this ran: a cached page can be parsed whole before the deferred script
      // executes, and without this those frames would shimmer for ever.
      if (poster.complete) poster.naturalWidth ? settle(frame) : fail(frame);
      else { poster.addEventListener('load', () => settle(frame), {once: true}); poster.addEventListener('error', () => fail(frame), {once: true}); }
    } else if (video.readyState >= 2) settle(frame);
    else { video.addEventListener('loadeddata', () => settle(frame), {once: true}); video.addEventListener('error', () => fail(frame), {once: true}); }

    if (video) {
      // The film gets its own reveal, keyed to having a first frame rather than to the frame settling.
      const reveal = () => { if (video.readyState >= 2) frame.classList.add('has-video'); };
      video.readyState >= 2 ? reveal() : video.addEventListener('loadeddata', reveal, {once: true});
      video.addEventListener('playing', reveal, {once: true});
    }

    // A picture that has begun loading and then neither arrives nor fails is treated as missing rather than
    // left shimmering for ever. The clock only runs for a frame the reader can actually see: a lazy picture
    // below the fold has not started yet, and calling that stalled would grey out every card on the page.
    if ('IntersectionObserver' in root) {
      const watching = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        watching.disconnect();
        setTimeout(() => { if (frame.classList.contains('is-pending')) fail(frame); }, 20000);
      }, {rootMargin: '200px'});
      watching.observe(frame);
    } else setTimeout(() => { if (frame.classList.contains('is-pending')) fail(frame); }, 20000);
  };

  // The viewer is a whole application in an iframe, so its placeholder is the page chrome rather than a
  // shimmer: the frame holds the mark and the words "loading the scene" until the scene says it is ready.
  const watchViewer = frame => {
    const page = frame.querySelector('iframe');
    if (!page) return;
    if (frame.dataset.watched) return;
    frame.dataset.watched = '1';
    const done = () => { frame.classList.add('is-loaded'); frame.removeAttribute('aria-busy'); };
    page.addEventListener('load', done, {once: true});
    frame.setAttribute('aria-busy', 'true');
    setTimeout(done, 30000);
  };

  const watch = () => {
    all('[data-frame]').forEach(node => {
      if (node.closest('.live__frame')) watchViewer(node);
      else watchFrame(node);
    });
  };

  // ——— Reading position ————————————————————————————————————————————————————————————————————————
  // The rail at the foot repeats nothing: it says how far down the page is, so a reader who has lost the
  // thread can see it at a glance without scrolling back up to find out.
  const gauge = () => {
    const out = root.querySelector('[data-progress]');
    const section = root.querySelector('[data-section]');
    if (!out && !section) return;
    let queued = false;
    const read = () => {
      queued = false;
      const doc = document.documentElement;
      const span = doc.scrollHeight - doc.clientHeight;
      const ratio = span > 0 ? Math.min(1, Math.max(0, doc.scrollTop / span)) : 0;
      if (out) out.textContent = `${Math.round(ratio * 100)}%`;
      const head = root.querySelector('[data-sticky]');
      if (head) head.classList.toggle('is-stuck', doc.scrollTop > 8);
      if (section) {
        // The section nearest the top of the viewport is the one being read.
        let current = '';
        for (const id of all('section[id], header.intro[id]')) {
          if (id.getBoundingClientRect().top <= 120) current = id.id;
        }
        if (current) section.textContent = current;
      }
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(read); } };
    read();
    addEventListener('scroll', schedule, {passive: true});
    addEventListener('resize', schedule, {passive: true});
  };

  // ——— Reveal on arrival ——————————————————————————————————————————————————————————————————————————
  // Cards rise into place as they come into view, the way a plate is laid down on a sheet. The starting
  // state is written by the script, immediately before observing, so a card already on screen is marked as
  // arrived in the same pass and a browser without IntersectionObserver keeps every card visible.
  const reveal = () => {
    const items = all('[data-reveal]');
    if (!items.length) return;
    if (reduced.matches || !('IntersectionObserver' in root)) return;
    const seen = new WeakMap();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const delay = seen.get(entry.target) ?? 0;
        entry.target.style.transitionDelay = `${delay}ms`;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    // A card is told to arrive as soon as any part of it touches the viewport, and the viewport is read a
    // little further down than it is drawn, so the fade has begun before the card is really in view. A
    // threshold above zero would leave a tall card sitting invisible in the last few pixels of the screen,
    // which is the one way an entrance animation can cost a reader their content.
    }, {rootMargin: '0px 0px 15% 0px', threshold: 0});
    // A run of cards in one grid arrives in reading order rather than all at once.
    all('.cards').forEach(grid => all('[data-reveal]', grid).forEach((item, i) => seen.set(item, i * 55)));
    for (const item of items) {
      item.classList.add('is-waiting');
      observer.observe(item);
    }
  };

  watch();
  gauge();
  reveal();
  // Late arrivals — a card that only exists after a build step — get the same treatment.
  new MutationObserver(watch).observe(root, {childList: true, subtree: true});
})();