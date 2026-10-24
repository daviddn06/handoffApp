/**
 * One axis per gesture for a box that scrolls both ways (a wide table with a
 * height cap, the service journal). A trackpad swipe is never perfectly
 * straight, so without this a sideways swipe also drifts the rows up and down.
 * The first wheel event of a gesture picks the axis by its larger delta, and
 * every event until the gesture pauses moves that axis only. A vertical swipe
 * at the box's top or bottom edge is left to the browser so the page keeps
 * scrolling. Boxes that scroll one way only are left alone.
 */
export function lockWheelAxis(box: HTMLElement): () => void {
  let axis: "x" | "y" | null = null;
  let timer = 0;
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // pinch zoom
    const canX = box.scrollWidth > box.clientWidth + 1;
    const canY = box.scrollHeight > box.clientHeight + 1;
    if (!canX || !canY) return;
    if (!axis)
      axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (axis = null), 160);
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1;
    if (axis === "x") {
      event.preventDefault();
      box.scrollLeft += event.deltaX * unit;
      return;
    }
    const dy = event.deltaY * unit;
    const atEdge =
      dy < 0
        ? box.scrollTop <= 0
        : box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    if (atEdge) return;
    event.preventDefault();
    box.scrollTop += dy;
  };
  box.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.clearTimeout(timer);
    box.removeEventListener("wheel", onWheel);
  };
}
