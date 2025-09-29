/**
 * Responsive Height Utility for Sketch Canvas
 *
 * Provides utilities for dynamic height management using modern CSS features
 * including clamp(), CSS custom properties, and container queries.
 */

import React from 'react';

export interface ResponsiveHeightConfig {
  /** Minimum height in px */
  min: number;
  /** Preferred height as vh unit */
  preferred: number;
  /** Maximum height in px */
  max: number;
}

export interface DeviceHeightConfig {
  mobile: ResponsiveHeightConfig;
  tablet: ResponsiveHeightConfig;
  desktop: ResponsiveHeightConfig;
  ultrawide: ResponsiveHeightConfig;
}

/**
 * Default responsive height configurations for different device types
 */
export const DEFAULT_HEIGHT_CONFIG: DeviceHeightConfig = {
  mobile: { min: 250, preferred: 40, max: 400 },
  tablet: { min: 350, preferred: 55, max: 650 },
  desktop: { min: 500, preferred: 70, max: 1000 },
  ultrawide: { min: 600, preferred: 60, max: 1200 }
};

/**
 * Generates a CSS clamp() value from responsive height config
 */
export const generateClampValue = (config: ResponsiveHeightConfig): string => {
  return `clamp(${config.min}px, ${config.preferred}vh, ${config.max}px)`;
};

/**
 * Applies dynamic CSS custom properties to a container element
 */
export const applyResponsiveHeight = (
  element: HTMLElement,
  config: DeviceHeightConfig = DEFAULT_HEIGHT_CONFIG
): void => {
  const style = element.style;

  // Set CSS custom properties
  style.setProperty('--sketch-mobile-height', generateClampValue(config.mobile));
  style.setProperty('--sketch-tablet-height', generateClampValue(config.tablet));
  style.setProperty('--sketch-desktop-height', generateClampValue(config.desktop));
  style.setProperty('--sketch-ultrawide-height', generateClampValue(config.ultrawide));

  // Set default min-height
  style.setProperty('--sketch-min-height', generateClampValue(config.desktop));
};

/**
 * Gets current viewport dimensions and determines device type
 */
export const getDeviceType = (): keyof DeviceHeightConfig => {
  const width = window.innerWidth;

  if (width <= 768) return 'mobile';
  if (width <= 1024) return 'tablet';
  if (width >= 1920) return 'ultrawide';
  return 'desktop';
};

/**
 * Gets optimal height configuration for current device
 */
export const getCurrentHeightConfig = (
  config: DeviceHeightConfig = DEFAULT_HEIGHT_CONFIG
): ResponsiveHeightConfig => {
  const deviceType = getDeviceType();
  return config[deviceType];
};

/**
 * Calculates actual height value in pixels from clamp configuration
 */
export const calculateActualHeight = (config: ResponsiveHeightConfig): number => {
  const viewportHeight = window.innerHeight;
  const preferredHeight = (viewportHeight * config.preferred) / 100;

  return Math.max(config.min, Math.min(preferredHeight, config.max));
};

/**
 * React hook for responsive height management
 */
export const useResponsiveHeight = (
  config: DeviceHeightConfig = DEFAULT_HEIGHT_CONFIG
) => {
  const [currentHeight, setCurrentHeight] = React.useState<number>(0);
  const [deviceType, setDeviceType] = React.useState<keyof DeviceHeightConfig>('desktop');

  React.useEffect(() => {
    const updateHeight = () => {
      const type = getDeviceType();
      const heightConfig = config[type];
      const actualHeight = calculateActualHeight(heightConfig);

      setDeviceType(type);
      setCurrentHeight(actualHeight);
    };

    // Initial calculation
    updateHeight();

    // Listen for resize events
    window.addEventListener('resize', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
    };
  }, [config]);

  return {
    currentHeight,
    deviceType,
    heightConfig: config[deviceType],
    clampValue: generateClampValue(config[deviceType])
  };
};

/**
 * Aspect ratio utilities for sketch canvas
 */
export interface AspectRatioConfig {
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
}

export const ASPECT_RATIOS = {
  SQUARE: { width: 1, height: 1, minHeight: 300, maxHeight: 600 },
  STANDARD: { width: 4, height: 3, minHeight: 400, maxHeight: 700 },
  WIDESCREEN: { width: 16, height: 9, minHeight: 400, maxHeight: 800 },
  ULTRAWIDE: { width: 21, height: 9, minHeight: 500, maxHeight: 900 }
} as const;

/**
 * Applies aspect ratio constraints to an element
 */
export const applyAspectRatio = (
  element: HTMLElement,
  ratio: AspectRatioConfig
): void => {
  const style = element.style;

  // Set aspect ratio if supported
  style.setProperty('aspect-ratio', `${ratio.width} / ${ratio.height}`);
  style.setProperty('min-height', `${ratio.minHeight}px`);
  style.setProperty('max-height', `${ratio.maxHeight}px`);

  // Add class for CSS feature detection
  element.classList.add('aspect-ratio-mode');
};

/**
 * Enables container query support for an element
 */
export const enableContainerQueries = (element: HTMLElement): void => {
  // Add container-type for container queries
  element.style.setProperty('container-type', 'inline-size');
  element.classList.add('container-query-enabled');
};

/**
 * Wall connectivity configuration for sketch editing
 */
export interface WallConnectivityConfig {
  /** Whether to automatically connect nearby walls when editing */
  enableAutoConnect: boolean;
  /** Distance tolerance in pixels for wall connection */
  connectionTolerance: number;
  /** Whether to show visual feedback during connection */
  showConnectionFeedback: boolean;
}

/**
 * Default configuration for wall connectivity
 */
export const DEFAULT_WALL_CONNECTIVITY: WallConnectivityConfig = {
  enableAutoConnect: true,
  connectionTolerance: 10,
  showConnectionFeedback: true
};

/**
 * Utility to check if two points are within connection tolerance
 */
export const arePointsConnectable = (
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  tolerance: number
): boolean => {
  const distance = Math.sqrt(
    Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2)
  );
  return distance <= tolerance;
};

/**
 * Configuration for irregular room shape editing behavior
 */
export interface IrregularShapeConfig {
  /** Allow walls to be edited independently for irregular shapes */
  allowIrregularShapes: boolean;
  /** Automatically connect nearby wall endpoints */
  autoConnectWalls: boolean;
  /** Distance tolerance for wall connections */
  connectionTolerance: number;
  /** Minimum wall length in pixels */
  minWallLength: number;
  /** Show visual guides during editing */
  showEditingGuides: boolean;
}

/**
 * Default configuration for irregular shape editing
 */
export const DEFAULT_IRREGULAR_SHAPE_CONFIG: IrregularShapeConfig = {
  allowIrregularShapes: true,
  autoConnectWalls: true,
  connectionTolerance: 10,
  minWallLength: 20,
  showEditingGuides: true
};

