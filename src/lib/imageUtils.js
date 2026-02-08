/**
 * Image Validation and Optimization Utility
 * Handles image validation, compression, and resizing for optimal performance
 */

// Image constraints for different types
export const IMAGE_CONSTRAINTS = {
  product: {
    maxSizeMB: 2,
    maxWidth: 800,
    maxHeight: 800,
    aspectRatio: 1, // Square (1:1)
    quality: 0.85,
    formats: ['image/jpeg', 'image/png', 'image/webp']
  },
  combo: {
    maxSizeMB: 2,
    maxWidth: 800,
    maxHeight: 800,
    aspectRatio: 1, // Square (1:1)
    quality: 0.85,
    formats: ['image/jpeg', 'image/png', 'image/webp']
  },
  carousel: {
    maxSizeMB: 3,
    maxWidth: 1920,
    maxHeight: 1080,
    aspectRatio: 16/9, // Widescreen
    quality: 0.9,
    formats: ['image/jpeg', 'image/png', 'image/webp']
  },
  carouselMobile: {
    maxSizeMB: 1.5,
    maxWidth: 800,
    maxHeight: 1200,
    aspectRatio: 2/3, // Portrait
    quality: 0.85,
    formats: ['image/jpeg', 'image/png', 'image/webp']
  },
  logo: {
    maxSizeMB: 2,
    maxWidth: 800,
    maxHeight: 400,
    aspectRatio: null, // Preserve original aspect ratio
    quality: 0.95,
    formats: ['image/png', 'image/svg+xml', 'image/webp'],
    outputFormat: 'image/png' // Preserve transparency
  },
  favicon: {
    maxSizeMB: 0.5,
    maxWidth: 256,
    maxHeight: 256,
    minWidth: 16,
    minHeight: 16,
    aspectRatio: null, // Maintain original aspect ratio
    quality: 1.0, // No quality loss for small icons
    formats: ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/svg+xml', 'image/webp'],
    skipResize: false, // Allow resizing to fit max dimensions
    outputFormat: 'image/png' // Output as PNG for broad compatibility
  },
  payment_proof: {
    maxSizeMB: 5,
    maxWidth: 2000,
    maxHeight: 2000,
    aspectRatio: null, // Any aspect ratio
    quality: 0.85,
    formats: ['image/jpeg', 'image/png', 'image/webp']
  },
  publication: {
    maxSizeMB: 5,
    maxWidth: 1200,
    maxHeight: 800,
    aspectRatio: null,
    quality: 0.85,
    formats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  }
};

/**
 * Validate image file before processing
 */
export const validateImage = (file, type = 'product') => {
  const constraints = IMAGE_CONSTRAINTS[type];
  const errors = [];

  // Check if file exists
  if (!file) {
    errors.push('No se seleccionó ningún archivo');
    return { valid: false, errors };
  }

  // Check file type
  if (!constraints.formats.includes(file.type)) {
    errors.push(`Formato no válido. Use: ${constraints.formats.map(f => f.split('/')[1]).join(', ')}`);
  }

  // Check file size
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > constraints.maxSizeMB) {
    errors.push(`Tamaño muy grande (${sizeMB.toFixed(2)}MB). Máximo: ${constraints.maxSizeMB}MB`);
  }

  return {
    valid: errors.length === 0,
    errors,
    sizeMB: sizeMB.toFixed(2)
  };
};

/**
 * Load image from file
 */
const loadImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Resize and compress image
 */
export const processImage = async (file, type = 'product') => {
  const constraints = IMAGE_CONSTRAINTS[type];

  // Validate first
  const validation = validateImage(file, type);
  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }

  try {
    // Special handling for .ico files - can't be processed in canvas, just convert to base64
    if (file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon') {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const sizeMB = file.size / (1024 * 1024);

      return {
        success: true,
        base64,
        blob: file,
        metadata: {
          originalSize: sizeMB.toFixed(2) + 'MB',
          finalSize: sizeMB.toFixed(2) + 'MB',
          compression: '0%',
          originalDimensions: 'N/A',
          finalDimensions: 'N/A',
          format: 'ICO',
          quality: '100%'
        }
      };
    }

    // Special handling for SVG files (don't process, just convert to base64)
    if (file.type === 'image/svg+xml') {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const sizeMB = file.size / (1024 * 1024);

      return {
        success: true,
        base64,
        blob: file,
        metadata: {
          originalSize: sizeMB.toFixed(2) + 'MB',
          finalSize: sizeMB.toFixed(2) + 'MB',
          compression: '0%',
          originalDimensions: 'Vector',
          finalDimensions: 'Vector',
          format: 'SVG',
          quality: '100%'
        }
      };
    }

    // Load image
    const img = await loadImage(file);

    // Calculate new dimensions maintaining aspect ratio
    let { width, height } = img;
    const currentAspect = width / height;
    const targetAspect = constraints.aspectRatio;

    // Crop to target aspect ratio if needed
    let cropWidth = width;
    let cropHeight = height;
    let offsetX = 0;
    let offsetY = 0;

    // Only crop if there's a target aspect ratio defined
    if (targetAspect && Math.abs(currentAspect - targetAspect) > 0.01) {
      if (currentAspect > targetAspect) {
        // Image is wider - crop width
        cropWidth = height * targetAspect;
        offsetX = (width - cropWidth) / 2;
      } else {
        // Image is taller - crop height
        cropHeight = width / targetAspect;
        offsetY = (height - cropHeight) / 2;
      }
    }

    // Scale down if larger than max dimensions
    let finalWidth = cropWidth;
    let finalHeight = cropHeight;

    if (finalWidth > constraints.maxWidth) {
      const scale = constraints.maxWidth / finalWidth;
      finalWidth = constraints.maxWidth;
      finalHeight = finalHeight * scale;
    }

    if (finalHeight > constraints.maxHeight) {
      const scale = constraints.maxHeight / finalHeight;
      finalHeight = constraints.maxHeight;
      finalWidth = finalWidth * scale;
    }

    // Create canvas and draw resized image
    const canvas = document.createElement('canvas');
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const ctx = canvas.getContext('2d');

    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw cropped and resized image
    ctx.drawImage(
      img,
      offsetX, offsetY, cropWidth, cropHeight,
      0, 0, finalWidth, finalHeight
    );

    // Convert to blob - use PNG for favicons to preserve transparency, JPEG otherwise
    const outputFormat = constraints.outputFormat || 'image/jpeg';
    const blob = await new Promise((resolve) => {
      canvas.toBlob(
        resolve,
        outputFormat,
        constraints.quality
      );
    });

    // Convert blob to base64
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    // Calculate compression stats
    const originalSizeMB = file.size / (1024 * 1024);
    const finalSizeMB = blob.size / (1024 * 1024);
    const compressionRatio = ((1 - finalSizeMB / originalSizeMB) * 100).toFixed(1);

    // Determine format name for metadata
    const formatName = outputFormat === 'image/png' ? 'PNG' :
                       outputFormat === 'image/webp' ? 'WebP' : 'JPEG';

    return {
      success: true,
      base64,
      blob,
      metadata: {
        originalSize: originalSizeMB.toFixed(2) + 'MB',
        finalSize: finalSizeMB.toFixed(2) + 'MB',
        compression: compressionRatio + '%',
        originalDimensions: `${img.width}x${img.height}`,
        finalDimensions: `${Math.round(finalWidth)}x${Math.round(finalHeight)}`,
        format: formatName,
        quality: (constraints.quality * 100) + '%'
      }
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw new Error('Error al procesar la imagen: ' + error.message);
  }
};

/**
 * Get image dimensions from file
 */
export const getImageDimensions = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Get recommended dimensions text for UI
 */
export const getRecommendedDimensionsText = (type = 'product') => {
  const constraints = IMAGE_CONSTRAINTS[type];
  const aspectText = constraints.aspectRatio === 1
    ? 'cuadrada (1:1)'
    : constraints.aspectRatio === 16/9
    ? 'horizontal (16:9)'
    : 'vertical (2:3)';

  return {
    dimensions: `${constraints.maxWidth}x${constraints.maxHeight}px`,
    aspectRatio: aspectText,
    maxSize: `${constraints.maxSizeMB}MB`,
    formats: constraints.formats.map(f => f.split('/')[1].toUpperCase()).join(', ')
  };
};

/**
 * Create a preview URL from file (for immediate display)
 */
export const createPreviewUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Validate and process image in one step
 */
export const validateAndProcessImage = async (file, type = 'product', onProgress = null) => {
  try {
    // Step 1: Validate
    if (onProgress) onProgress({ stage: 'validating', progress: 10 });
    const validation = validateImage(file, type);

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors
      };
    }

    // Step 2: Process
    if (onProgress) onProgress({ stage: 'processing', progress: 50 });
    const result = await processImage(file, type);

    if (onProgress) onProgress({ stage: 'complete', progress: 100 });

    return result;
  } catch (error) {
    return {
      success: false,
      errors: [error.message]
    };
  }
};
