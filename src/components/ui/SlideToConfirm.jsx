import React, { useState, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check, X } from 'lucide-react';

/**
 * SlideToConfirm - A drag-to-confirm interaction component
 * Prevents accidental actions by requiring an intentional slide gesture.
 *
 * @prop {boolean} show - Whether the slider is visible
 * @prop {function} onConfirm - Called when slide completes
 * @prop {function} onCancel - Called when cancelled
 * @prop {string} label - Text shown on the track (e.g. "Slide to confirm")
 * @prop {string} confirmLabel - Text shown when threshold reached (e.g. "Release to confirm")
 * @prop {string} className - Additional classes for the container
 * @prop {string} trackColor - Tailwind gradient for the filled track
 */
const SlideToConfirm = ({
  show,
  onConfirm,
  onCancel,
  label = 'Slide to confirm',
  confirmLabel = 'Release to confirm',
  className = '',
  trackColor = 'from-blue-500 to-indigo-600'
}) => {
  const containerRef = useRef(null);
  const [confirmed, setConfirmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const x = useMotionValue(0);

  const HANDLE_SIZE = 48;
  const THRESHOLD = 0.8;

  const getMaxDrag = useCallback(() => {
    if (!containerRef.current) return 200;
    return containerRef.current.offsetWidth - HANDLE_SIZE - 8; // 8 = padding
  }, []);

  // Transform x position to opacity for the fill track
  const fillWidth = useTransform(x, [0, getMaxDrag()], ['0%', '100%']);
  const fillOpacity = useTransform(x, [0, getMaxDrag() * 0.5, getMaxDrag()], [0, 0.3, 0.6]);
  const labelOpacity = useTransform(x, [0, getMaxDrag() * 0.3], [1, 0]);
  const confirmLabelOpacity = useTransform(x, [getMaxDrag() * 0.6, getMaxDrag() * 0.8], [0, 1]);
  const checkScale = useTransform(x, [getMaxDrag() * 0.7, getMaxDrag()], [0, 1]);

  const handleDragStart = () => {
    setDragging(true);
  };

  const handleDragEnd = () => {
    setDragging(false);
    const maxDrag = getMaxDrag();
    const currentX = x.get();

    if (currentX >= maxDrag * THRESHOLD) {
      setConfirmed(true);
      // Animate to end, then call onConfirm
      setTimeout(() => {
        onConfirm();
        // Reset after a short delay
        setTimeout(() => {
          setConfirmed(false);
          x.set(0);
        }, 500);
      }, 300);
    }
    // If not past threshold, framer-motion's dragElastic + dragConstraints snap it back
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0, marginTop: 0 }}
          animate={{ height: 'auto', opacity: 1, marginTop: 12 }}
          exit={{ height: 0, opacity: 0, marginTop: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={`overflow-hidden ${className}`}
        >
          <div className="flex items-center gap-2">
            {/* Slide track */}
            <div
              ref={containerRef}
              className="relative flex-1 h-12 bg-gray-100 rounded-full overflow-hidden border border-gray-200 select-none"
            >
              {/* Filled background */}
              <motion.div
                className={`absolute inset-y-0 left-0 bg-gradient-to-r ${trackColor} rounded-full`}
                style={{ width: fillWidth, opacity: fillOpacity }}
              />

              {/* Default label (fades out as you drag) */}
              <motion.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ opacity: labelOpacity }}
              >
                <span className="text-sm font-medium text-gray-500 flex items-center gap-1">
                  {label}
                  <ChevronRight className="w-4 h-4 animate-pulse" />
                </span>
              </motion.div>

              {/* Confirm label (fades in near end) */}
              <motion.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ opacity: confirmLabelOpacity }}
              >
                <span className="text-sm font-semibold text-blue-700 flex items-center gap-1">
                  <motion.span style={{ scale: checkScale }}>
                    <Check className="w-4 h-4" />
                  </motion.span>
                  {confirmLabel}
                </span>
              </motion.div>

              {/* Draggable handle */}
              <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: getMaxDrag() }}
                dragElastic={0.05}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                style={{ x }}
                className={`absolute top-1 left-1 w-10 h-10 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg transition-colors ${
                  confirmed
                    ? 'bg-green-500'
                    : dragging
                      ? 'bg-blue-600'
                      : 'bg-white border border-blue-300'
                }`}
                whileTap={{ scale: 1.1 }}
              >
                {confirmed ? (
                  <Check className="w-5 h-5 text-white" />
                ) : (
                  <ChevronRight className={`w-5 h-5 ${dragging ? 'text-white' : 'text-blue-600'}`} />
                )}
              </motion.div>
            </div>

            {/* Cancel button */}
            <motion.button
              onClick={onCancel}
              className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors border border-gray-200"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Cancel"
            >
              <X className="w-4 h-4 text-gray-500" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SlideToConfirm;
