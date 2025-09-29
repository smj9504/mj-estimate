# Interior Sketch System - Component Architecture

## Component Hierarchy Overview

The sketch system follows a modular, composable architecture that integrates seamlessly with the existing MJ React App patterns and Ant Design components.

```
SketchCanvas (Root Container)
├── SketchToolbar (Tool Selection & Actions)
│   ├── ToolPalette (Drawing Tools)
│   ├── ViewControls (Zoom, Pan, Fit)
│   ├── ActionButtons (Undo, Redo, Clear)
│   └── ExportMenu (Export Options)
├── SketchViewport (Main Drawing Area)
│   ├── GridOverlay (Background Grid)
│   ├── WallLayer (Wall Rendering)
│   │   ├── WallElement (Individual Walls)
│   │   └── WallConnector (Wall Joints)
│   ├── RoomLayer (Room Areas)
│   │   └── RoomElement (Individual Rooms)
│   ├── FixtureLayer (Fixtures & Openings)
│   │   ├── DoorFixture (Door Components)
│   │   ├── WindowFixture (Window Components)
│   │   ├── CabinetFixture (Cabinet Components)
│   │   └── CustomFixture (Generic Fixtures)
│   ├── DimensionLayer (Measurements)
│   │   ├── WallDimension (Wall Measurements)
│   │   ├── RoomDimension (Room Measurements)
│   │   └── AreaLabel (Area Calculations)
│   └── InteractionLayer (Mouse/Touch Handling)
├── SketchSidebar (Properties & Inspector)
│   ├── PropertyPanel (Element Properties)
│   ├── AreaCalculations (Area Summaries)
│   ├── RoomList (Room Management)
│   └── LayerControls (Visibility Controls)
├── SketchModals (Dialog Components)
│   ├── RoomPropertiesModal (Room Settings)
│   ├── FixtureLibraryModal (Fixture Selection)
│   ├── ExportModal (Export Configuration)
│   └── TemplateModal (Template Management)
└── SketchStatusBar (Status Information)
    ├── CoordinateDisplay (Mouse Position)
    ├── ZoomLevel (Current Zoom)
    ├── UnitToggle (Measurement Units)
    └── GridToggle (Grid Visibility)
```

## Component Categories

### 1. Container Components
- **SketchCanvas**: Root container that orchestrates the entire sketch system
- **SketchViewport**: Main drawing area with SVG rendering
- **SketchSidebar**: Properties and management panel

### 2. Rendering Components
- **WallLayer**: Renders all walls with proper layering
- **RoomLayer**: Renders room boundaries and fills
- **FixtureLayer**: Renders all fixtures and openings
- **DimensionLayer**: Renders measurements and labels
- **GridOverlay**: Background grid system

### 3. Interactive Components
- **SketchToolbar**: Tool selection and primary actions
- **PropertyPanel**: Dynamic property editing
- **InteractionLayer**: Handles all user input

### 4. Modal/Dialog Components
- **RoomPropertiesModal**: Room-specific settings
- **FixtureLibraryModal**: Fixture selection and customization
- **ExportModal**: Export options and preview

### 5. Utility Components
- **MeasurementInput**: Feet/inches input component
- **CoordinateDisplay**: Real-time coordinate feedback
- **AreaSummary**: Area calculation display

## Design Principles

### Reusability
- Each component is self-contained with clear props interface
- Shared styling through consistent theme system
- Generic fixture components that can be extended
- Composable architecture for different use cases

### Performance
- SVG-based rendering for scalability
- Virtualization for large numbers of elements
- Memoized calculations and rendering
- Efficient event handling with throttling

### Accessibility
- Full keyboard navigation support
- Screen reader compatibility
- High contrast mode support
- Touch-friendly interface for mobile

### Integration
- Follows Ant Design theming and patterns
- Integrates with existing Zustand state management
- Compatible with current routing and layout
- Extensible for future document types

## State Isolation

Each sketch instance maintains its own isolated state through:

1. **SketchProvider**: Context provider for sketch-specific state
2. **Unique Instance IDs**: Each sketch canvas has a unique identifier
3. **Scoped Event Handling**: Events are scoped to specific instances
4. **Independent Undo/Redo**: History management per instance
5. **Cleanup on Unmount**: Proper resource cleanup when components unmount

This allows multiple sketch components to coexist on the same page without interference.