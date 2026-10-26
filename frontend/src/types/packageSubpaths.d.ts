/**
 * Type paths for package subpath exports the project's TypeScript setting
 * (moduleResolution "node") can't follow, though webpack does. Each re-exports
 * the declarations the package ships for that subpath.
 */

declare module 'three/webgpu' {
  export * from 'three/build/three.webgpu';
}

declare module 'three-gpu-pathtracer/webgpu' {
  export * from 'three-gpu-pathtracer/src/webgpu/index';
}
