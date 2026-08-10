import * as Tooltip from '@radix-ui/react-tooltip';
import { Info } from 'lucide-react';

export function InfoTooltip({ text, className = '' }) {
  if (!text) return null;

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={text}
            className={`inline-flex items-center justify-center text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-full ${className}`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="max-w-xs rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-md z-50"
            sideOffset={5}
          >
            {text}
            <Tooltip.Arrow className="fill-current text-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
