import { forwardRef, type ComponentProps, type ElementType } from 'react';

function AnimatePresence({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

// Surfaces the reduced-motion preference to tests. Real motion/react uses this
// to gate transform animations on the OS `prefers-reduced-motion` setting; the
// mock just exposes the configured value so wiring can be asserted.
function MotionConfig({
  reducedMotion,
  children,
}: {
  reducedMotion?: 'always' | 'never' | 'user';
  children?: React.ReactNode;
}) {
  return <div data-testid="motion-config" data-reduced-motion={reducedMotion}>{children}</div>;
}

// The real motion/react library returns the same component reference every
// time a given tag (`motion.div`, `motion.span`, ...) is accessed, so React's
// reconciler sees a stable `type` across renders and never remounts a
// `motion.*` element just because its parent re-rendered. Cache per tag here
// too: without it, every property access minted a fresh `forwardRef`
// component, so any unrelated re-render of a component that reads
// `motion.div` from JSX (e.g. `{cond ? <motion.div>...</motion.div> : null}`)
// looked like a brand-new element type to React and forced an unmount +
// remount of the whole subtree on every such render — a real bug this mock
// was injecting, not one the app has (see App.connectors.test.tsx's
// `clickButtonAndAssert` docblock for the symptom this produced).
const componentCache = new Map<string, ReturnType<typeof forwardRef>>();

const motionHandler: ProxyHandler<object> = {
  get(_target, prop: string) {
    const cached = componentCache.get(prop);
    if (cached) return cached;
    const Component = forwardRef<unknown, ComponentProps<ElementType>>((props, ref) => {
      const {
        variants: _variants,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        whileHover: _whileHover,
        whileTap: _whileTap,
        transition: _transition,
        layout: _layout,
        layoutId: _layoutId,
        ...rest
      } = props as Record<string, unknown>;
      const Tag = prop as ElementType;
      return <Tag ref={ref} {...rest} />;
    });
    Component.displayName = `motion.${prop}`;
    componentCache.set(prop, Component);
    return Component;
  },
};

const motion = new Proxy({}, motionHandler);

// jsdom has no matchMedia; components under test always see "no reduced
// motion" so their full animation props stay assertable.
function useReducedMotion(): boolean {
  return false;
}

export { AnimatePresence, MotionConfig, motion, useReducedMotion };
