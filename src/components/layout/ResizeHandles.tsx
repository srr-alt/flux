import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

// Undecorated windows on Linux/GTK lose the window manager's resize
// borders entirely, so they have to be recreated by hand: a thin
// invisible strip per edge/corner that starts a native resize drag.
const EDGE = 6;
const CORNER = 12;

const HANDLES: {
  direction:
    | "North"
    | "South"
    | "East"
    | "West"
    | "NorthEast"
    | "NorthWest"
    | "SouthEast"
    | "SouthWest";
  className: string;
  cursor: string;
}[] = [
  { direction: "North", className: "left-0 right-0 top-0", cursor: "n-resize" },
  { direction: "South", className: "left-0 right-0 bottom-0", cursor: "s-resize" },
  { direction: "West", className: "top-0 bottom-0 left-0", cursor: "w-resize" },
  { direction: "East", className: "top-0 bottom-0 right-0", cursor: "e-resize" },
  { direction: "NorthWest", className: "left-0 top-0", cursor: "nw-resize" },
  { direction: "NorthEast", className: "right-0 top-0", cursor: "ne-resize" },
  { direction: "SouthWest", className: "left-0 bottom-0", cursor: "sw-resize" },
  { direction: "SouthEast", className: "right-0 bottom-0", cursor: "se-resize" },
];

export function ResizeHandles() {
  return (
    <>
      {HANDLES.map(({ direction, className, cursor }) => {
        const isCorner = direction.length > 5;
        const isVertical = direction === "North" || direction === "South";
        const size = isCorner
          ? { width: CORNER, height: CORNER }
          : isVertical
            ? { height: EDGE }
            : { width: EDGE };
        return (
          <div
            key={direction}
            onMouseDown={(e) => {
              if (e.buttons === 1) win.startResizeDragging(direction);
            }}
            className={`fixed z-50 ${className}`}
            style={{ ...size, cursor }}
          />
        );
      })}
    </>
  );
}
