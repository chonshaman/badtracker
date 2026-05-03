type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

export function runViewTransition(update: () => void) {
  const transition = (document as ViewTransitionDocument).startViewTransition?.(update);
  if (!transition) update();
}
