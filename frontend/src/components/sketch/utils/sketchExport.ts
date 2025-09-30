/**
 * Export utilities for sketch documents
 */

import {
  SketchDocument,
  SketchExportOptions,
  SketchExportResult
} from '../../../types/sketch';

/**
 * Export sketch document to various formats
 */
export const exportSketchDocument = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  try {
    switch (options.format) {
      case 'json':
        return exportToJson(sketch, options);
      case 'svg':
        return exportToSvg(sketch, options);
      case 'pdf':
        return exportToPdf(sketch, options);
      case 'png':
        return exportToPng(sketch, options);
      case 'dxf':
        return exportToDxf(sketch, options);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  } catch (error) {
    return {
      data: new Blob([''], { type: 'text/plain' }),
      filename: 'export-error.txt',
      mimeType: 'text/plain'
    };
  }
};

/**
 * Export sketch to JSON format
 */
const exportToJson = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  const jsonData = {
    ...sketch,
    exportMetadata: {
      exportedAt: new Date().toISOString(),
      exportOptions: options,
      version: '1.0.0'
    }
  };

  const jsonString = JSON.stringify(jsonData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });

  return {
    data: blob,
    filename: `${sketch.name}.json`,
    mimeType: 'application/json'
  };
};

/**
 * Export sketch to SVG format
 */
const exportToSvg = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  const width = options.scale || 800;
  const height = options.quality || 600;

  let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <title>${sketch.name}</title>
  <desc>Interior sketch exported from MJ Estimate</desc>`;

  // Add background
  svgContent += `
  <rect width="100%" height="100%" fill="#ffffff" />`;

  // Add grid if requested
  if (options.includeDimensions && sketch.settings.display.showGrid) {
    svgContent += generateGridSvg(width, height, 20);
  }

  // Add rooms (as filled polygons)
  sketch.rooms.forEach(room => {
    if (room.boundary.length > 0) {
      const points = room.boundary.map(point => `${point.x},${point.y}`).join(' ');
      svgContent += `
  <polygon points="${points}"
           fill="${room.style.fillColor}"
           fill-opacity="${room.style.opacity}"
           stroke="${room.style.strokeColor}"
           stroke-width="${room.style.strokeWidth}"/>
  <text x="${room.boundary[0].x}" y="${room.boundary[0].y - 10}"
        font-family="Arial" font-size="12" fill="#333">${room.name}</text>`;
    }
  });

  // Add walls (as lines)
  sketch.walls.forEach(wall => {
    svgContent += `
  <line x1="${wall.start.x}" y1="${wall.start.y}"
        x2="${wall.end.x}" y2="${wall.end.y}"
        stroke="${wall.style.strokeColor}"
        stroke-width="${wall.style.strokeWidth}"
        stroke-linecap="round"/>`;
  });

  // Add fixtures (as rectangles or circles)
  sketch.wallFixtures.forEach(fixture => {
    // Find the wall this fixture belongs to
    const wall = sketch.walls.find(w => w.id === fixture.wallId);
    if (!wall) return;

    const wallLength = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) +
      Math.pow(wall.end.y - wall.start.y, 2)
    );
    const x = wall.start.x + (wall.end.x - wall.start.x) * fixture.position;
    const y = wall.start.y + (wall.end.y - wall.start.y) * fixture.position;
    const { width, height } = fixture.dimensions;

    svgContent += `
  <rect x="${x - width/2}" y="${y - height/2}"
        width="${width}" height="${height}"
        fill="${fixture.style.fillColor}"
        stroke="${fixture.style.strokeColor}"
        stroke-width="${fixture.style.strokeWidth}"/>
  <text x="${x}" y="${y + height/2 + 15}"
        font-family="Arial" font-size="10"
        text-anchor="middle" fill="#333">${fixture.type}</text>`;
  });

  svgContent += '\n</svg>';

  const blob = new Blob([svgContent], { type: 'image/svg+xml' });

  return {
    data: blob,
    filename: `${sketch.name}.svg`,
    mimeType: 'image/svg+xml'
  };
};

/**
 * Generate SVG grid pattern
 */
const generateGridSvg = (width: number, height: number, gridSize: number): string => {
  let gridContent = `
  <defs>
    <pattern id="grid" width="${gridSize}" height="${gridSize}" patternUnits="userSpaceOnUse">
      <path d="M ${gridSize} 0 L 0 0 0 ${gridSize}" fill="none" stroke="#e0e0e0" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)" />`;

  return gridContent;
};

/**
 * Export sketch to PDF format (placeholder)
 */
const exportToPdf = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  // This would require a PDF generation library like jsPDF or PDF-lib
  // For now, return a placeholder
  throw new Error('PDF export not yet implemented. Use SVG export as an alternative.');
};

/**
 * Export sketch to PNG format (placeholder)
 */
const exportToPng = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  // This would require canvas rendering and conversion to PNG
  // For now, return a placeholder
  throw new Error('PNG export not yet implemented. Use SVG export as an alternative.');
};

/**
 * Export sketch to DXF format (placeholder)
 */
const exportToDxf = async (
  sketch: SketchDocument,
  options: SketchExportOptions
): Promise<SketchExportResult> => {
  // This would require a DXF generation library
  // For now, return a placeholder
  throw new Error('DXF export not yet implemented. This will be added for CAD compatibility.');
};

/**
 * Create download link for exported data
 */
export const downloadExportedFile = (result: SketchExportResult): void => {
  if (!result.data) {
    console.error('Cannot download: No data available');
    return;
  }

  // Handle both string and Blob data types
  let blob: Blob;
  if (typeof result.data === 'string') {
    // Convert string to Blob if needed
    blob = new Blob([result.data], { type: result.mimeType || 'text/plain' });
  } else {
    blob = result.data;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename || 'sketch-export';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
};