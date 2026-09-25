import { useEffect, useRef, useState } from 'react';

/**
 * Home-page Lottie preloader gate (Delphic-style).
 *
 * On the first visit of a browser session it shows a fixed full-screen white
 * overlay running `d_preloader.json` on a loop while critical home images are
 * fetched in the background. The page is only revealed once BOTH:
 *   - at least one full Lottie loop has completed, and
 *   - the home assets have finished loading.
 * The overlay then fades/scales/blurs out (~300ms) and unmounts.
 *
 * Fail-open: if the Lottie JSON can't be fetched/parsed we reveal as soon as
 * the assets are ready. Persisted with a sessionStorage flag — on any later
 * navigation back to the home page in the same session we skip the Lottie and
 * only wait for assets (which are almost always warm in the browser cache).
 */

const SESSION_KEY = 'site_preloader_played';
const LOTTIE_SRC = '/assets/preloader/d_preloader.json';
const FADE_MS = 320;

/** Critical images the home shell paints — kept small on purpose. */
const HOME_ASSETS = ['/delphic-logo.png', '/Delphic_D-logo_transparent.png'];

function hasPlayed() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markPlayed() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}

function preloadImages(sources) {
  return Promise.all(
    sources.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = resolve; // never block the reveal on a missing asset
          img.src = src;
        })
    )
  );
}

export default function HomePreloaderGate({ children, assets = HOME_ASSETS }) {
  const played = hasPlayed();
  const [revealed, setRevealed] = useState(played);
  const [overlayMounted, setOverlayMounted] = useState(!played);
  const [fadingOut, setFadingOut] = useState(false);
  const lottieRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // Revisit in the same session: skip Lottie, just let assets warm then reveal.
    if (played) {
      preloadImages(assets).then(() => {
        if (!cancelled) setRevealed(true);
      });
      return () => {
        cancelled = true;
      };
    }

    let anim = null;
    let finished = false;
    const gate = { loop: false, assets: false };

    function maybeFinish() {
      if (finished || cancelled || !gate.loop || !gate.assets) return;
      finished = true;
      markPlayed();
      setFadingOut(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setRevealed(true);
        setOverlayMounted(false);
        anim?.destroy();
      }, FADE_MS);
    }

    preloadImages(assets).then(() => {
      gate.assets = true;
      maybeFinish();
    });

    Promise.all([
      import('lottie-web').then((mod) => mod.default || mod),
      fetch(LOTTIE_SRC).then((res) => {
        if (!res.ok) throw new Error(`preloader ${res.status}`);
        return res.json();
      }),
    ])
      .then(([lottie, animationData]) => {
        if (cancelled || !lottieRef.current) return;
        anim = lottie.loadAnimation({
          container: lottieRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        anim.addEventListener('loopComplete', () => {
          gate.loop = true;
          maybeFinish();
        });
      })
      .catch(() => {
        // Fail open — don't hold the page hostage to the animation.
        gate.loop = true;
        maybeFinish();
      });

    return () => {
      cancelled = true;
      anim?.destroy();
    };
    // `played` and `assets` are effectively constant for the lifetime of the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div hidden={!revealed}>{children}</div>
      {overlayMounted && (
        <div
          className={`site-preloader${fadingOut ? ' site-preloader--out' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={!revealed}
        >
          <div ref={lottieRef} className="site-preloader__lottie" aria-hidden="true" />
          <span className="sr-only">Loading Delphic…</span>
        </div>
      )}
    </>
  );
}
