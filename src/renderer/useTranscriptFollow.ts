import { useCallback, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_MARGIN = 24;

export function useTranscriptFollow(content: unknown) {
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const pin = useCallback(() => {
    const area = viewport.current;
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
    setAwayFromBottom(false);
  }, []);

  const followLatest = useCallback(() => {
    following.current = true;
    pin();
  }, [pin]);

  const onScroll = useCallback(() => {
    const area = viewport.current;
    if (!area) return;
    const away = area.scrollHeight - area.scrollTop - area.clientHeight > BOTTOM_MARGIN;
    following.current = !away;
    setAwayFromBottom(away);
  }, []);

  useLayoutEffect(() => {
    // Smooth scrolling emits intermediate scroll events away from the bottom.
    // Pin synchronously so those events cannot turn following off on new speech.
    if (following.current) pin();
  }, [content, pin]);

  useLayoutEffect(() => {
    const area = viewport.current;
    const contents = body.current;
    if (!area || !contents) return;
    const observer = new ResizeObserver(() => {
      if (following.current) pin();
      else onScroll();
    });
    observer.observe(area);
    observer.observe(contents);
    return () => observer.disconnect();
  }, [pin, onScroll]);

  const jumpTo = useCallback((lineId: string) => {
    const area = viewport.current;
    const line = area?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`);
    if (!area || !line) return;
    following.current = false;
    line.focus({ preventScroll: true });
    const offset = line.getBoundingClientRect().top - area.getBoundingClientRect().top;
    area.scrollTo({ top: area.scrollTop + offset - (area.clientHeight - line.clientHeight) / 2, behavior: "instant" });
    onScroll();
  }, [onScroll]);

  return { viewport, body, awayFromBottom, followLatest, jumpTo, onScroll };
}
