import React from 'react';
import { cn } from '@/lib/utils';

/**
 * One cell per item, all in the same grid cell: the container is as tall as the tallest item whatever the active
 * one is, so changing slide never moves what is below or around it (autoplay shifts count as layout shift).
 * Inactive items stay laid out but invisible and hidden from assistive tech. `live` makes the container an
 * aria-live region ('off' | 'polite') so a manual change of slide is announced.
 */
const StackedSlides = ({ items, current, render, testId, className, live, containerRef }) => (
  <div ref={containerRef} data-testid={testId} aria-live={live} className={cn('grid', className)}>
    {items.map((item, i) => (
      <div
        key={item.id ?? i}
        className={cn('col-start-1 row-start-1', i !== current && 'invisible')}
        aria-hidden={i !== current ? 'true' : undefined}
      >
        {render(item)}
      </div>
    ))}
  </div>
);

export default StackedSlides;
