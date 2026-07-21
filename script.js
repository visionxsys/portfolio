/* ═══════════════════════════════════════════════════════════
   MAISON FORME — script.js  (v2 — 180-frame high-FPS rebuild)
   Canvas scroll animation engine + all site interactions
═══════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────────────
   ① CANVAS SCROLL-SCRUB ANIMATION ENGINE
   - Dynamically detects total frame count (no hardcoding)
   - Preloads first PRELOAD_COUNT frames, lazy-loads the rest
   - RAF lerp loop: slow-in → smooth → slow-out
   - Full range: frame 0 → totalFrames-1 maps to 0→100% scroll
   - No flicker: never draws until image is fully decoded
   - Fallback: static first frame if any load fails badly
────────────────────────────────────────────────────────── */
(function HeroCanvasEngine() {

  /* ── Config ── */
  const FRAME_DIR      = 'public/frames/';
  const FRAME_PREFIX   = 'ezgif-frame-';
  const FRAME_EXT      = '.png';
  const PRELOAD_COUNT  = 18;   // eagerly loaded before reveal
  const LERP_FACTOR    = 0.10; // 0.08 = very smooth, 0.18 = snappier
  const SNAP_THRESHOLD = 0.05; // snap to target when this close

  /* ── DOM refs ── */
  const canvas      = document.getElementById('heroCanvas');
  const ctx         = canvas && canvas.getContext('2d');
  const heroSection = document.getElementById('hero');
  const heroContent = document.getElementById('heroContent');
  const scrollHint  = document.getElementById('scrollHint');

  if (!canvas || !ctx || !heroSection) return;

  /* ── State ── */
  let totalFrames   = 0;
  let images        = [];        // array of HTMLImageElement | null
  let loadedFlags   = [];        // true = this index is fully ready to draw
  let currentFrame  = 0;        // float, animated value
  let targetFrame   = 0;        // float, set from scroll
  let rafId         = null;
  let isReady       = false;    // preload phase complete
  let textRevealed  = false;
  let dpr           = window.devicePixelRatio || 1;

  /* ── Utilities ── */
  function zeroPad(n, width) {
    return String(n).padStart(width, '0');
  }

  function frameSrc(index) {
    // 1-based, 3-digit padding: ezgif-frame-001.png … ezgif-frame-180.png
    return `${FRAME_DIR}${FRAME_PREFIX}${zeroPad(index + 1, 3)}${FRAME_EXT}`;
  }

  /* ── Canvas sizing — retina-aware ── */
  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;

    // Only resize if dimensions actually changed
    if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return;

    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';

    // Redraw current frame immediately after resize
    const idx = Math.round(currentFrame);
    if (loadedFlags[idx]) drawFrame(idx);
  }

  /* ── Cover-fit draw — fills canvas, maintains aspect ratio ── */
  function drawFrame(index) {
    const idx = Math.max(0, Math.min(totalFrames - 1, Math.round(index)));
    if (!loadedFlags[idx] || !images[idx]) return;

    const img = images[idx];
    const cw  = canvas.width  / dpr;   // logical pixels
    const ch  = canvas.height / dpr;
    const iw  = img.naturalWidth;
    const ih  = img.naturalHeight;

    if (iw === 0 || ih === 0) return;

    // Cover-fit scale
    const scale = Math.max(cw / iw, ch / ih);
    const sw    = iw * scale;
    const sh    = ih * scale;
    const ox    = (cw - sw) * 0.5;
    const oy    = (ch - sh) * 0.5;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(dpr, dpr);     // draw at logical size, canvas handles HiDPI
    ctx.drawImage(img, ox, oy, sw, sh);
    ctx.restore();
  }

  /* ── Easing — ease-in-out cubic ── */
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* ── Map scroll → target frame ── */
  function updateTargetFrame() {
    if (!heroSection || totalFrames === 0) return;

    const sectionTop    = heroSection.offsetTop;
    const sectionHeight = heroSection.offsetHeight;   // 500vh
    const windowHeight  = window.innerHeight;
    const scrollY       = window.scrollY;

    // How many pixels user can scroll within the pinned section
    const scrollable = sectionHeight - windowHeight;
    if (scrollable <= 0) return;

    const rawProgress = (scrollY - sectionTop) / scrollable;
    const progress    = Math.max(0, Math.min(1, rawProgress));

    // Apply easing so motion feels slow-in, smooth-mid, slow-out
    const eased = easeInOutCubic(progress);

    // Map 0→1 to 0→(totalFrames-1) — FULL RANGE, no premature stop
    targetFrame = eased * (totalFrames - 1);

    /* ── Hero text visibility ── */
    if (!textRevealed && progress <= 0.01) {
      heroContent.classList.add('revealed');
      heroContent.classList.remove('fading');
      textRevealed = true;
    }

    // Removed the mid-scroll fade logic so text stays fully visible over the video frames

    // Scroll hint
    if (progress > 0.05) {
      scrollHint && scrollHint.classList.add('hidden');
    } else {
      scrollHint && scrollHint.classList.remove('hidden');
    }
  }

  /* ── RAF render loop — lerp toward targetFrame ── */
  function renderLoop() {
    if (!isReady) { rafId = requestAnimationFrame(renderLoop); return; }

    const diff = targetFrame - currentFrame;

    if (Math.abs(diff) < SNAP_THRESHOLD) {
      // Snap to avoid infinite micro-updates
      if (currentFrame !== targetFrame) {
        currentFrame = targetFrame;
        drawFrame(currentFrame);
      }
    } else {
      // Smooth lerp — independent of framerate via time-based damping
      currentFrame += diff * LERP_FACTOR;
      drawFrame(currentFrame);
    }

    rafId = requestAnimationFrame(renderLoop);
  }

  /* ── Load a single frame image ── */
  function loadFrame(index) {
    return new Promise((resolve) => {
      if (loadedFlags[index]) { resolve(true); return; }

      const img = new Image();
      img.decoding = 'async';

      img.onload = () => {
        // Ensure decode is complete before marking ready
        if (img.decode) {
          img.decode().then(() => {
            images[index]      = img;
            loadedFlags[index] = true;
            resolve(true);
          }).catch(() => {
            images[index]      = img;
            loadedFlags[index] = true;
            resolve(true);
          });
        } else {
          images[index]      = img;
          loadedFlags[index] = true;
          resolve(true);
        }
      };

      img.onerror = () => {
        // On failure use frame 0 as fallback
        if (index !== 0 && images[0]) {
          images[index]      = images[0];
          loadedFlags[index] = true;
        }
        resolve(false);
      };

      img.src = frameSrc(index);
    });
  }

  /* ── Detect total frame count by probing sequentially ── */
  async function detectFrameCount() {
    // Strategy: try loading frames until one fails (404/error)
    // We already know it's 180 from the folder, but we probe to stay dynamic.
    // For speed: probe via HEAD-like approach — load in chunks of 20.
    let count = 0;
    const CHUNK = 20;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const probe = new Image();
      const src   = frameSrc(count);

      const result = await new Promise((res) => {
        probe.onload  = () => res(true);
        probe.onerror = () => res(false);
        probe.src     = src;
      });

      if (result) {
        count++;
        // After each successful probe, try skipping ahead for speed
        if (count % CHUNK === 0) {
          // Check if count + CHUNK exists to skip ahead faster
          const skip = new Image();
          const skipSrc = frameSrc(count + CHUNK - 1);
          const skipResult = await new Promise(res => {
            skip.onload  = () => res(true);
            skip.onerror = () => res(false);
            skip.src     = skipSrc;
          });
          if (skipResult) {
            // That chunk exists, jump to it
            count += CHUNK;
          }
        }
      } else {
        break; // First failing index = total count
      }

      // Safety cap at 500 frames
      if (count >= 500) break;
    }

    return count;
  }

  /* ── Fast parallel count probe (binary search style) ── */
  async function detectFrameCountFast() {
    // Binary search: find the highest frame index that loads
    let lo = 0;
    let hi = 400; // upper bound

    // First verify hi exists or reduce
    const hiCheck = new Image();
    const hiExists = await new Promise(res => {
      hiCheck.onload  = () => res(true);
      hiCheck.onerror = () => res(false);
      hiCheck.src     = frameSrc(hi);
    });
    if (!hiExists) {
      // Binary search between 0 and 400
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        const midCheck = new Image();
        const exists = await new Promise(res => {
          midCheck.onload  = () => res(true);
          midCheck.onerror = () => res(false);
          midCheck.src     = frameSrc(mid);
        });
        if (exists) lo = mid;
        else         hi = mid - 1;
      }
      return lo + 1; // count = last valid index + 1
    }

    return hi + 1;
  }

  /* ── Main boot sequence ── */
  async function boot() {
    // Set initial canvas size
    resizeCanvas();

    // Draw gradient placeholder while loading
    drawPlaceholder();

    // ── Phase 1: detect total frame count ──
    // For performance: try a known set of sizes first, fall back to probe
    const knownProbe = [180, 120, 90, 60, 51, 30];
    let detected = 0;

    for (const n of knownProbe) {
      const testImg = new Image();
      const exists  = await new Promise(res => {
        testImg.onload  = () => res(true);
        testImg.onerror = () => res(false);
        testImg.src     = frameSrc(n - 1); // 0-indexed
      });
      if (exists) { detected = n; break; }
    }

    // If none matched, fall back to binary search
    if (detected === 0) {
      detected = await detectFrameCountFast();
    }

    // Refine: check a few frames above detected to ensure we have the real max
    for (let i = detected; i < detected + 10; i++) {
      const extra = new Image();
      const ok    = await new Promise(res => {
        extra.onload  = () => res(true);
        extra.onerror = () => res(false);
        extra.src     = frameSrc(i);
      });
      if (ok) detected = i + 1;
      else    break;
    }

    totalFrames = Math.max(detected, 1);
    images      = new Array(totalFrames).fill(null);
    loadedFlags = new Array(totalFrames).fill(false);

    console.log(`[Hero] Detected ${totalFrames} frames.`);

    // ── Mobile Check: Render static last frame ──
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      const lastIdx = totalFrames - 1;
      await loadFrame(lastIdx);
      isReady = true;
      resizeCanvas();
      drawFrame(lastIdx);

      setTimeout(() => {
        heroContent.classList.add('revealed');
        textRevealed = true;
      }, 250);

      if (scrollHint) scrollHint.classList.add('hidden');
      console.log(`[Hero] Mobile detected. Rendered static last frame (${lastIdx}).`);
      return; // Exit boot early, skipping animation loops
    }

    // ── Phase 2: eagerly load first PRELOAD_COUNT frames ──
    const eagerCount  = Math.min(PRELOAD_COUNT, totalFrames);
    const eagerLoads  = [];
    for (let i = 0; i < eagerCount; i++) eagerLoads.push(loadFrame(i));
    await Promise.all(eagerLoads);

    // ── Ready ──
    isReady = true;
    resizeCanvas();
    drawFrame(0);

    // Reveal hero text with a slight delay
    setTimeout(() => {
      heroContent.classList.add('revealed');
      textRevealed = true;
    }, 250);

    // Start RAF render loop
    rafId = requestAnimationFrame(renderLoop);

    // ── Phase 3: lazy-load remaining frames in background ──
    // Load in small bursts with tiny gaps to keep UI responsive
    const BURST = 6;
    for (let i = eagerCount; i < totalFrames; i += BURST) {
      const burst = [];
      for (let j = i; j < Math.min(i + BURST, totalFrames); j++) {
        burst.push(loadFrame(j));
      }
      await Promise.all(burst);
      // Small yield so main thread stays responsive
      await new Promise(r => setTimeout(r, 16));
    }

    console.log(`[Hero] All ${totalFrames} frames loaded.`);
  }

  /* ── Placeholder while frames load ── */
  function drawPlaceholder() {
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    ctx.save();
    ctx.scale(dpr, dpr);
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2c2824');
    grad.addColorStop(0.5, '#1e1b18');
    grad.addColorStop(1, '#1a1714');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /* ── Scroll handler ── */
  let scrollTicking = false;
  function onScroll() {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        updateTargetFrame();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }

  /* ── Resize handler with debounce ── */
  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
      updateTargetFrame();
    }, 80);
  }

  /* ── Wire events ── */
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  // Boot!
  boot().catch(err => {
    console.warn('[Hero] Boot error:', err);
    drawPlaceholder();
    // Still reveal text even on error
    heroContent && heroContent.classList.add('revealed');
  });

})(); // end HeroCanvasEngine


/* ──────────────────────────────────────────────────────────
   ② NAVBAR — transparent → solid on scroll
────────────────────────────────────────────────────────── */
(function NavbarBehavior() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  let ticking = false;

  function update() {
    if (window.scrollY > 50) {
      navbar.classList.add('solid');
      navbar.classList.remove('transparent');
    } else {
      navbar.classList.remove('solid');
      navbar.classList.add('transparent');
    }
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });

  navbar.classList.add('transparent');
  update();
})();


/* ──────────────────────────────────────────────────────────
   ③ MOBILE DRAWER
────────────────────────────────────────────────────────── */
(function MobileDrawer() {
  const hamburger = document.getElementById('hamburgerBtn');
  const drawer    = document.getElementById('mobileDrawer');
  const closeBtn  = document.getElementById('drawerClose');
  const backdrop  = document.getElementById('drawerBackdrop');
  if (!hamburger || !drawer) return;

  const open  = () => { drawer.classList.add('open'); backdrop.classList.add('visible'); document.body.style.overflow = 'hidden'; hamburger.setAttribute('aria-expanded', 'true'); };
  const close = () => { drawer.classList.remove('open'); backdrop.classList.remove('visible'); document.body.style.overflow = ''; hamburger.setAttribute('aria-expanded', 'false'); };

  hamburger.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();


/* ──────────────────────────────────────────────────────────
   ④ SCROLL REVEAL — IntersectionObserver
────────────────────────────────────────────────────────── */
(function ScrollReveal() {
  const els = document.querySelectorAll('[data-animate]');
  if (!els.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el    = entry.target;
      const delay = parseInt(el.dataset.delay || '0', 10);
      setTimeout(() => el.classList.add('animated'), delay);
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  els.forEach(el => io.observe(el));
})();


/* ──────────────────────────────────────────────────────────
   ⑤ COUNTER ANIMATION — trust bar stats
────────────────────────────────────────────────────────── */
(function CounterAnimation() {
  const counters = document.querySelectorAll('.trust-number[data-target]');
  const bar      = document.querySelector('.trust-bar');
  if (!bar || !counters.length) return;

  let done = false;

  function animateAll() {
    counters.forEach(el => {
      const target   = parseInt(el.dataset.target, 10);
      const duration = 1800;
      const start    = performance.now();

      function step(now) {
        const p   = Math.min((now - start) / duration, 1);
        const val = Math.round((1 - Math.pow(1 - p, 3)) * target); // ease-out cubic
        el.textContent = val;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  const io = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !done) {
      done = true;
      animateAll();
      io.disconnect();
    }
  }, { threshold: 0.35 });

  io.observe(bar);
})();


/* ──────────────────────────────────────────────────────────
   ⑥ TESTIMONIALS SLIDER — auto-play + touch swipe + dots
────────────────────────────────────────────────────────── */
(function TestimonialsSlider() {
  const track   = document.getElementById('testimonialsTrack');
  const dots    = document.querySelectorAll('.t-dot');
  const prevBtn = document.getElementById('tPrev');
  const nextBtn = document.getElementById('tNext');
  if (!track) return;

  const cards  = track.querySelectorAll('.testimonial-card');
  const total  = cards.length;
  let current  = 0;
  let timer;

  function goTo(idx) {
    current = ((idx % total) + total) % total;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-selected', String(i === current));
    });
  }

  const startAuto = () => { timer = setInterval(() => goTo(current + 1), 5000); };
  const stopAuto  = () => clearInterval(timer);

  prevBtn?.addEventListener('click', () => { stopAuto(); goTo(current - 1); startAuto(); });
  nextBtn?.addEventListener('click', () => { stopAuto(); goTo(current + 1); startAuto(); });
  dots.forEach(d => d.addEventListener('click', () => { stopAuto(); goTo(+d.dataset.index); startAuto(); }));

  // Pause on hover
  const wrap = document.querySelector('.testimonials-wrap');
  wrap?.addEventListener('mouseenter', stopAuto);
  wrap?.addEventListener('mouseleave', startAuto);

  // Touch swipe
  let tx = 0;
  track.addEventListener('touchstart', e => { tx = e.changedTouches[0].clientX; }, { passive: true });
  track.addEventListener('touchend',   e => {
    const d = tx - e.changedTouches[0].clientX;
    if (Math.abs(d) > 50) { stopAuto(); goTo(current + (d > 0 ? 1 : -1)); startAuto(); }
  }, { passive: true });

  goTo(0);
  startAuto();
})();


/* ──────────────────────────────────────────────────────────
   ⑦ SMOOTH ANCHOR SCROLL
────────────────────────────────────────────────────────── */
(function SmoothAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();


/* ──────────────────────────────────────────────────────────
   ⑧ PARALLAX — promo bed image
────────────────────────────────────────────────────────── */
(function PromoParallax() {
  const bg = document.getElementById('promoBg');
  if (!bg) return;

  const col = bg.closest('.promo-image-col');
  let ticking = false;

  function update() {
    const rect     = col.getBoundingClientRect();
    const winH     = window.innerHeight;
    const progress = 1 - (rect.top + rect.height) / (winH + rect.height);
    const shift    = (progress - 0.5) * 50; // ±25px
    bg.style.transform = `translateY(${shift}px) scale(1.06)`;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });

  update();
})();
