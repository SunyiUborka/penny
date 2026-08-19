/** Ennyi képpontnyi lehúzás után indul a frissítés. */
const TRIGGER_PX = 72;

/** Ennél laposabb (vízszintesebb) mozdulatot nem tekintünk lehúzásnak. */
const HORIZONTAL_TOLERANCE_PX = 24;

/**
 * Lehúzásos frissítés az oldal tetején. Csak akkor aktiválódik, ha a görgetés
 * már legfelül áll, és a mozdulat túlnyomóan függőleges — így nem üti el a
 * vízszintes gesztusokat és a rendes görgetést.
 *
 * @param {{ onRefresh: () => Promise<void>, onProgress: (ratio: number) => void }} options
 * @returns {() => void} a leszerelő függvény
 */
export function attachPullToRefresh(options) {
  const { onRefresh, onProgress } = options;

  let startY = null;
  let startX = 0;
  let refreshing = false;

  /** @param {TouchEvent} event */
  const handleStart = (event) => {
    if (refreshing || window.scrollY > 0) {
      // Frissítés közben vagy legfelülről elgörgetve egy új érintés nem
      // indíthat lehúzást, de a látható jelzést sem szabad bántani: itt
      // úgysem folyt lehúzás, amit vissza kellene állítani.
      startY = null;
      return;
    }
    if (event.touches.length !== 1) {
      // Egy második ujj (csippentés) menet közben is idekerülhet: ha épp
      // folyt egy lehúzás, a jelzést is vissza kell állítani, különben
      // beragad a képernyőn.
      if (startY !== null) {
        onProgress(0);
      }
      startY = null;
      return;
    }
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
  };

  /** @param {TouchEvent} event */
  const handleMove = (event) => {
    if (startY === null) {
      return;
    }
    const deltaY = event.touches[0].clientY - startY;
    const deltaX = Math.abs(event.touches[0].clientX - startX);
    if (deltaY <= 0 || deltaX > HORIZONTAL_TOLERANCE_PX) {
      startY = null;
      onProgress(0);
      return;
    }
    onProgress(Math.min(deltaY / TRIGGER_PX, 1));
  };

  /**
   * Lefuttatja a frissítést, majd a kimenetelétől (siker vagy hiba)
   * függetlenül visszaállítja a gesztus állapotát.
   */
  const finishRefresh = async () => {
    try {
      await onRefresh();
    } catch {
      // A hívó dolga eldönteni, mit kezd a hibával; itt csak a gesztus
      // állapotát kell visszaállítani.
    } finally {
      refreshing = false;
      onProgress(0);
    }
  };

  /** @param {TouchEvent} event */
  const handleEnd = (event) => {
    if (startY === null) {
      return;
    }
    const deltaY = event.changedTouches[0].clientY - startY;
    startY = null;
    if (deltaY < TRIGGER_PX) {
      onProgress(0);
      return;
    }
    refreshing = true;
    onProgress(1);
    finishRefresh();
  };

  /**
   * Android rutinszerűen megszakítja az érintéssorozatot (értesítési sáv,
   * rendszer vissza-/él-gesztus, bejövő hívás): ilyenkor a `touchend` sosem
   * fut le, a `handleEnd` sem tudja visszaállítani a jelzést, ami így a
   * "Húzd lejjebb a frissítéshez" felirattal a képernyőn ragadna.
   */
  const handleCancel = () => {
    startY = null;
    onProgress(0);
  };

  window.addEventListener('touchstart', handleStart, { passive: true });
  window.addEventListener('touchmove', handleMove, { passive: true });
  window.addEventListener('touchend', handleEnd, { passive: true });
  window.addEventListener('touchcancel', handleCancel, { passive: true });

  return () => {
    window.removeEventListener('touchstart', handleStart);
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', handleEnd);
    window.removeEventListener('touchcancel', handleCancel);
  };
}
