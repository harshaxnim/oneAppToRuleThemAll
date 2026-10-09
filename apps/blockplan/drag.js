// One gesture controller for mouse, pen, and touch.
// Mouse and pen drag after a small movement. Touch drags after a short press
// and hold, so a plain swipe still scrolls the page or the timeline.
// The app decides what a position means; this module only tracks the gesture,
// draws the floating block, and scrolls the timeline near its edges.
const HOLD_MS = 260, MOVE_SLOP = 6, TOUCH_SLOP = 9, EDGE = 44;

export function attachDrag(root, app) {
  let pending = null, active = null, frame = 0, swallowClick = false;
  const supportsVibrate = 'vibrate' in navigator;

  function clearPending() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
  }
  function activate() {
    if (!pending) return;
    const { el, mode, id, x, y, rect } = pending;
    clearTimeout(pending.timer);
    const info = app.begin({ el, mode, id });
    if (!info) { clearPending(); return; }
    active = { ...pending, info, lastX: x, lastY: y };
    pending = null;
    document.documentElement.classList.add('dragging');
    if (mode !== 'resize') {
      const ghost = el.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      // Start at the picked-up size, then settle to the true timeline length.
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      requestAnimationFrame(() => { ghost.style.width = `${info.width}px`; });
      // Keep the grab point under the finger even if the ghost changes width.
      active.grabX = Math.min((x - rect.left) * info.width / rect.width, info.width);
      // A tiny block is still grabbed by its middle rather than its edge.
      if (info.width < 24) active.grabX = info.width / 2;
      active.grabY = y - rect.top;
      document.body.append(ghost);
      active.ghost = ghost;
      el.classList.add('lifted');
    }
    if (active.type === 'touch' && supportsVibrate) navigator.vibrate?.(8);
    move(x, y);
    frame = requestAnimationFrame(autoScroll);
  }
  function move(clientX, clientY) {
    if (!active) return;
    active.lastX = clientX; active.lastY = clientY;
    if (active.ghost) active.ghost.style.transform = `translate(${clientX - active.grabX}px, ${clientY - active.grabY}px)`;
    app.move({ ...active, clientX, clientY, left: clientX - (active.grabX ?? 0) });
  }
  function autoScroll() {
    if (!active) return;
    const scroller = app.scroller();
    const rect = scroller.getBoundingClientRect();
    const { lastX: x, lastY: y } = active;
    if (y > rect.top - 80 && y < rect.bottom + 40) {
      let delta = 0;
      if (x < rect.left + EDGE) delta = -Math.ceil((rect.left + EDGE - x) / 4);
      else if (x > rect.right - EDGE) delta = Math.ceil((x - rect.right + EDGE) / 4);
      if (delta) {
        const before = scroller.scrollLeft;
        scroller.scrollLeft += Math.max(-18, Math.min(18, delta));
        if (scroller.scrollLeft !== before) move(x, y);
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }
  function finish(commit) {
    cancelAnimationFrame(frame);
    const session = active;
    active = null;
    document.documentElement.classList.remove('dragging');
    if (!session) return;
    session.ghost?.remove();
    session.el.classList.remove('lifted');
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    app.end({ ...session, commit });
  }

  root.addEventListener('pointerdown', event => {
    if (active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = event.target.closest('[data-drag]');
    if (!handle || !root.contains(handle)) return;
    const el = handle.closest('[data-id]');
    const mode = handle.dataset.drag;
    pending = {
      el, mode, id: el.dataset.id, x: event.clientX, y: event.clientY, type: event.pointerType,
      pointerId: event.pointerId, rect: el.getBoundingClientRect(), timer: 0,
    };
    if (mode === 'resize') {
      event.preventDefault();
      activate();
    } else if (event.pointerType === 'touch') {
      pending.timer = setTimeout(activate, HOLD_MS);
    }
  });
  window.addEventListener('pointermove', event => {
    if (active && event.pointerId === active.pointerId) {
      event.preventDefault();
      move(event.clientX, event.clientY);
      return;
    }
    if (!pending || event.pointerId !== pending.pointerId) return;
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (pending.type === 'touch') {
      // Moving before the hold completes means the person is scrolling.
      if (distance > TOUCH_SLOP) clearPending();
    } else if (distance > MOVE_SLOP) {
      activate();
      move(event.clientX, event.clientY);
    }
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (active && event.pointerId === active.pointerId) finish(true);
    else if (pending && event.pointerId === pending.pointerId) clearPending();
  });
  window.addEventListener('pointercancel', event => {
    if (active && event.pointerId === active.pointerId) finish(false);
    else if (pending && event.pointerId === pending.pointerId) clearPending();
  });
  // Once a touch drag is live, stop the browser from scrolling underneath it.
  document.addEventListener('touchmove', event => { if (active) event.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', event => { if (event.target.closest('[data-drag]')) event.preventDefault(); });
  root.addEventListener('click', event => {
    if (swallowClick) { event.stopPropagation(); event.preventDefault(); }
  }, true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); finish(false); } });
  window.addEventListener('blur', () => { if (active) finish(false); clearPending(); });
  return { get active() { return Boolean(active); }, cancel() { if (active) finish(false); clearPending(); } };
}
